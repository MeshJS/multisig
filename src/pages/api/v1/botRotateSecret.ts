import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyStrictRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import {
  generateBotKeySecret,
  hashBotKeySecret,
  verifyBotKeySecret,
} from "@/lib/auth/botKey";
import { audit } from "@/lib/observability/audit";
import { getClientIP } from "@/lib/security/rateLimit";

/**
 * Self-service secret rotation: the pickup secret is one-time to READ but
 * permanent to USE, so a leaked secret needs a rotation path that doesn't
 * involve re-registering the bot. Proving possession of the current secret
 * authorizes minting a replacement; the old secret stops working immediately.
 * The new secret is returned exactly once — store it.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);

  if (!applyStrictRateLimit(req, res, { keySuffix: "v1/botRotateSecret", maxRequests: 5 })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!enforceBodySize(req, res, 2 * 1024)) {
    return;
  }

  const { botKeyId, secret } = req.body;
  if (typeof botKeyId !== "string" || typeof secret !== "string") {
    return res.status(400).json({ error: "Missing required fields: botKeyId, secret" });
  }

  const botKey = await db.botKey.findUnique({ where: { id: botKeyId } });
  if (!botKey || !verifyBotKeySecret(secret, botKey.keyHash)) {
    return res.status(401).json({ error: "Invalid bot key" });
  }

  const newSecret = generateBotKeySecret();
  await db.botKey.update({
    where: { id: botKey.id },
    data: { keyHash: hashBotKeySecret(newSecret) },
  });

  void audit(db, {
    actorAddress: botKey.ownerAddress,
    actorType: "bot",
    action: "bot.secret_rotated",
    resourceType: "botKey",
    resourceId: botKey.id,
    ip: getClientIP(req),
    userAgent: req.headers["user-agent"] ?? null,
    outcome: "success",
  });

  return res.status(200).json({ botKeyId: botKey.id, secret: newSecret });
}
