import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyStrictRateLimit } from "@/lib/security/requestGuards";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);

  if (!applyStrictRateLimit(req, res, { keySuffix: "v1/botPickupSecret" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // --- Validate query param ---

  const { pendingBotId } = req.query;

  if (typeof pendingBotId !== "string" || pendingBotId.length < 1) {
    return res.status(400).json({ error: "invalid_pickup_payload", message: "pendingBotId query parameter is required" });
  }

  // --- Load PendingBot and return secret ---

  try {
    const result = await db.$transaction(async (tx) => {
      const pendingBot = await tx.pendingBot.findUnique({
        where: { id: pendingBotId },
      });

      if (!pendingBot) {
        throw new PickupError(404, "not_found", "No pending bot found with that ID");
      }

      if (pendingBot.status !== "CLAIMED") {
        throw new PickupError(404, "not_yet_claimed", "Bot has not been claimed yet");
      }

      if (pendingBot.pickedUp) {
        throw new PickupError(410, "already_picked_up", "Secret has already been collected");
      }

      const secret = pendingBot.secretCipher;
      if (!secret) {
        throw new PickupError(410, "already_picked_up", "Secret is no longer available");
      }

      // Find the BotUser by paymentAddress (unique) to get the botKeyId
      const botUser = await tx.botUser.findUnique({
        where: { paymentAddress: pendingBot.paymentAddress },
      });

      if (!botUser) {
        throw new PickupError(500, "internal_error", "Bot user not found");
      }

      // Mark as picked up and clear the secret
      await tx.pendingBot.update({
        where: { id: pendingBotId },
        data: {
          pickedUp: true,
          secretCipher: null,
        },
      });

      return {
        botKeyId: botUser.botKeyId,
        secret,
        paymentAddress: pendingBot.paymentAddress,
      };
    });

    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof PickupError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    console.error("botPickupSecret error:", err);
    return res.status(500).json({ error: "internal_error", message: "An unexpected error occurred" });
  }
}

class PickupError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "PickupError";
  }
}
