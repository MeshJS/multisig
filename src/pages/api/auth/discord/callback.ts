import { type NextApiRequest, type NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { db } from "@/server/db";
import { audit } from "@/lib/observability/audit";
import { getClientIP } from "@/lib/security/rateLimit";

const { verify } = jwt;

type DiscordOAuthState = {
  address: string;
  // short-lived nonce; binding to a session cookie is the long-term fix but
  // a signed, time-bound state already closes the open-redirect/CSRF that
  // shipped before (raw `state = userAddress` was attacker-forgeable).
  nonce: string;
};

function verifyState(raw: string): DiscordOAuthState | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = verify(raw, secret) as Partial<DiscordOAuthState>;
    if (!payload || typeof payload.address !== "string" || typeof payload.nonce !== "string") {
      return null;
    }
    return { address: payload.address, nonce: payload.nonce };
  } catch {
    return null;
  }
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

  const verifiedState = verifyState(state);
  if (!verifiedState) {
    void audit(db, {
      actorType: "user",
      action: "auth.discord.state_invalid",
      ip: getClientIP(req),
      userAgent: req.headers["user-agent"] ?? null,
      outcome: "denied",
      reason: "Invalid or expired state",
    });
    return res.status(400).json({ error: "Invalid or expired state" });
  }
  const userAddress = verifiedState.address;

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
      await db.user.update({
        where: { address: userAddress },
        data: { discordId: user.id },
      });

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
