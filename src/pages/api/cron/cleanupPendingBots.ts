import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit } from "@/lib/security/requestGuards";

/**
 * Cleanup stale PendingBot and BotClaimToken records.
 *
 * Protected by CRON_SECRET bearer token.
 * Intended to be called by a scheduled job (e.g. GitHub Actions, Vercel Cron).
 *
 * Deletes:
 *  - Expired unclaimed PendingBot records (> 10 min old, status UNCLAIMED)
 *  - Consumed BotClaimToken records older than 1 hour
 *  - Clears secretCipher on claimed-but-not-picked-up PendingBots older than 15 min
 */

const TEN_MINUTES_MS = 10 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "cron/cleanupPendingBots" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Verify cron secret
  const authToken = req.headers.authorization?.replace("Bearer ", "");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken) {
    console.error("CRON_SECRET environment variable not set");
    return res.status(500).json({ error: "Server configuration error" });
  }

  if (!authToken || authToken !== expectedToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = new Date();

  try {
    // 1. Delete expired unclaimed PendingBot records (cascade deletes BotClaimToken)
    const expiredUnclaimed = await db.pendingBot.deleteMany({
      where: {
        status: "UNCLAIMED",
        expiresAt: { lt: new Date(now.getTime() - TEN_MINUTES_MS) },
      },
    });

    // 2. Delete consumed BotClaimToken records older than 1 hour
    const consumedTokens = await db.botClaimToken.deleteMany({
      where: {
        consumedAt: { not: null },
        createdAt: { lt: new Date(now.getTime() - ONE_HOUR_MS) },
      },
    });

    // 3. Clear secretCipher on claimed-but-not-picked-up PendingBots older than 15 min
    const staleSecrets = await db.pendingBot.updateMany({
      where: {
        status: "CLAIMED",
        pickedUp: false,
        secretCipher: { not: null },
        createdAt: { lt: new Date(now.getTime() - FIFTEEN_MINUTES_MS) },
      },
      data: {
        secretCipher: null,
      },
    });

    console.log(
      `[cleanupPendingBots] Deleted ${expiredUnclaimed.count} expired unclaimed bots, ` +
        `${consumedTokens.count} consumed tokens, ` +
        `cleared ${staleSecrets.count} stale secrets`,
    );

    return res.status(200).json({
      success: true,
      deletedExpiredUnclaimed: expiredUnclaimed.count,
      deletedConsumedTokens: consumedTokens.count,
      clearedStaleSecrets: staleSecrets.count,
    });
  } catch (error) {
    console.error("[cleanupPendingBots] Error:", error);
    return res.status(500).json({ error: "Cleanup failed" });
  }
}
