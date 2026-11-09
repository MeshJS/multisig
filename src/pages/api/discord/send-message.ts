import { type NextApiRequest, type NextApiResponse } from "next";
import { db } from "@/server/db";
import { getWalletSessionFromReq } from "@/lib/auth/walletSession";
import { getSiteUrl } from "@/lib/notifications/center";
import {
  applyAddressRateLimit,
  applyStrictRateLimit,
  enforceBodySize,
} from "@/lib/security/requestGuards";
import {
  DISCORD_NOTIFICATION_KINDS,
  authorizeWalletNotification,
  buildDiscordNotification,
  isDiscordNotificationKind,
  isDiscordSnowflake,
  isWalletId,
} from "@/lib/discord/walletNotification";

/** Same cap as `user.getDiscordIds`, which is where callers get the ids. */
const MAX_RECIPIENTS = 50;

/**
 * Sends a wallet notification (new transaction, CC vote, signature reminder)
 * as a DM from the project's Discord bot to signers of that wallet.
 *
 * The bot speaks for the project, so the caller must hold a wallet session
 * and be a signer or owner of the wallet, recipients must be that wallet's
 * signers, and the server writes the text from a fixed template.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!applyStrictRateLimit(req, res, { keySuffix: "discordSend" })) return;
  if (!enforceBodySize(req, res, 16 * 1024)) return;

  const session = getWalletSessionFromReq(req);
  const sessionAddresses = session?.wallets ?? [];
  if (sessionAddresses.length === 0) {
    return res.status(401).json({ error: "Sign in with a wallet first" });
  }
  // Per signer as well as per IP: anyone can create a wallet that lists a
  // stranger's public address as a signer, so the IP limit alone would let a
  // rotating-IP caller keep DMing that stranger.
  const principal = session?.primaryWallet ?? sessionAddresses[0]!;
  if (!applyAddressRateLimit(req, res, `discordSend:${principal}`, 10)) return;

  const { walletId, kind, discordIds } = (req.body ?? {}) as {
    walletId?: unknown;
    kind?: unknown;
    discordIds?: unknown;
  };
  if (!isWalletId(walletId)) {
    return res.status(400).json({ error: "walletId is required" });
  }
  if (!isDiscordNotificationKind(kind)) {
    return res.status(400).json({
      error: `kind must be one of ${DISCORD_NOTIFICATION_KINDS.join(", ")}`,
    });
  }
  if (
    !Array.isArray(discordIds) ||
    discordIds.length > MAX_RECIPIENTS ||
    !discordIds.every(isDiscordSnowflake)
  ) {
    return res.status(400).json({
      error: `discordIds must be at most ${MAX_RECIPIENTS} Discord user ids`,
    });
  }

  const recipients = [...new Set(discordIds)];

  try {
    const access = await authorizeWalletNotification(
      db,
      walletId,
      sessionAddresses,
      recipients,
    );
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    // All-or-nothing: callers only ever send the wallet's own signers, so a
    // stranger in the list means the request did not come from the app.
    if (recipients.some((id) => !access.permitted.has(id))) {
      return res
        .status(403)
        .json({ error: "Recipients must be signers of this wallet" });
    }
    // A wallet whose signers linked no Discord account sends an empty list;
    // that is a successful no-op, as it always was.
    if (recipients.length === 0) {
      return res.status(200).json({ success: true });
    }

    const message = buildDiscordNotification(kind, access.wallet, getSiteUrl());

    for (const discordId of recipients) {
      // Create DM Channel
      const response = await fetch(
        "https://discord.com/api/v10/users/@me/channels",
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ recipient_id: discordId }),
        },
      );

      const dmChannel = await response.json();

      if (dmChannel.id) {
        const messageResponse = await fetch(
          `https://discord.com/api/v10/channels/${dmChannel.id}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ content: message }),
          },
        );
        if (!messageResponse.ok) {
          return res
            .status(messageResponse.status)
            .json({ error: "Failed to send message" });
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Discord message error:", error);
    res.status(500).json({ error: "Failed to send Discord messages" });
  }
}
