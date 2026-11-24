import { type NextApiRequest, type NextApiResponse } from "next";
import { db } from "@/server/db";
import { audit } from "@/lib/observability/audit";
import { getClientIP } from "@/lib/security/rateLimit";
import {
  DISCORD_LINK_NONCE_COOKIE,
  clearDiscordLinkNonceCookie,
  nonceMatchesCookie,
  verifyDiscordLinkState,
} from "@/lib/auth/discordLinkState";
import { getWalletSessionFromReq } from "@/lib/auth/walletSession";

/**
 * Whether the browser finishing the flow holds a wallet session for the
 * address the state names.
 *
 * A signed state alone proves only that *some* session started the flow. An
 * attacker could start it for their own wallet, then send the Discord authorize
 * URL to a victim: the victim's approval would link the victim's Discord
 * account to the attacker's wallet, and the attacker's notifications and
 * Discord DMs about that wallet would go to the victim. Requiring the same
 * session at the callback means only the person who started the flow can
 * finish it. The session cookie is SameSite=Lax, so the top-level redirect
 * back from discord.com carries it.
 */
function sessionHoldsAddress(req: NextApiRequest, address: string): boolean {
  const session = getWalletSessionFromReq(req);
  if (!session) return false;
  const wallets = Array.isArray(session.wallets) ? session.wallets : [];
  return session.primaryWallet === address || wallets.includes(address);
}

const REDACT_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
]);

function redactSecrets(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k) ? "[REDACTED]" : v;
  }
  return out;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { code, state } = req.query;

  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "No code provided" });
  }

  if (!state || typeof state !== "string") {
    return res.status(400).json({ error: "No state provided" });
  }

  // One attempt per started flow: the nonce cookie goes whatever happens next.
  res.setHeader("Set-Cookie", clearDiscordLinkNonceCookie());

  const verifiedState = verifyDiscordLinkState(state);
  if (
    !verifiedState ||
    !nonceMatchesCookie(verifiedState.nonce, req.cookies?.[DISCORD_LINK_NONCE_COOKIE])
  ) {
    void audit(db, {
      actorType: "user",
      action: "auth.discord.state_invalid",
      ip: getClientIP(req),
      userAgent: req.headers["user-agent"] ?? null,
      outcome: "denied",
      reason: "Invalid, expired, replayed or foreign-browser state",
    });
    return res.status(400).json({ error: "Invalid or expired state" });
  }
  const userAddress = verifiedState.address;

  if (!sessionHoldsAddress(req, userAddress)) {
    void audit(db, {
      actorAddress: userAddress,
      actorType: "user",
      action: "auth.discord.session_mismatch",
      resourceType: "user",
      resourceId: userAddress,
      ip: getClientIP(req),
      userAgent: req.headers["user-agent"] ?? null,
      outcome: "denied",
      reason: "No wallet session for the address that started the link",
    });
    return res.status(403).json({
      error: "Finish linking Discord in the browser where you started it, signed in with the same wallet",
    });
  }

  try {
    const redirectUri =
      process.env.NODE_ENV === "production"
        ? "https://multisig.meshjs.dev/api/auth/discord/callback"
        : "http://localhost:3000/api/auth/discord/callback";

    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: params,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const raw = await tokenResponse.text();
    let tokens: Record<string, unknown>;
    try {
      tokens = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.error("[Discord Token] non-JSON response", { status: tokenResponse.status });
      throw new Error("Discord returned non-JSON on token exchange");
    }

    if (tokens.error) {
      console.error("[Discord Token] error", redactSecrets(tokens));
      return res.status(400).json({ error: tokens.error_description ?? "Discord token error" });
    }

    const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : null;
    if (!accessToken) {
      return res.status(400).json({ error: "No access token from Discord" });
    }

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const user = (await userResponse.json()) as { id?: string } | null;
    if (user?.id) {
      // updateMany, not update: a wallet with no User row is a 404, not a
      // Prisma "record not found" surfacing as a 500.
      const linked = await db.user.updateMany({
        where: { address: userAddress },
        data: { discordId: user.id },
      });
      if (linked.count === 0) {
        return res.status(404).json({ error: "No user record for this wallet" });
      }

      void audit(db, {
        actorAddress: userAddress,
        actorType: "user",
        action: "auth.discord.linked",
        resourceType: "user",
        resourceId: userAddress,
        ip: getClientIP(req),
        userAgent: req.headers["user-agent"] ?? null,
        outcome: "success",
      });

      const guildId = process.env.DISCORD_GUILD_ID;
      const guildMemberCheck = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/members/${user.id}`,
        {
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          },
        },
      );

      if (guildMemberCheck.status === 404) {
        return res.redirect("https://discord.gg/DkNPvvGTqK");
      }
    }

    res.redirect("/");
  } catch (error) {
    console.error("Discord auth error:", error instanceof Error ? error.message : "unknown");
    res.status(500).json({ error: "Failed to authenticate with Discord" });
  }
}
