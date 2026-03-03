import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { sign } from "jsonwebtoken";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyStrictRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { verifyBotKeySecret, parseScope, scopeIncludes, type BotScope } from "@/lib/auth/botKey";

const MIN_SCOPE = "multisig:read";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);

  if (!applyStrictRateLimit(req, res, { keySuffix: "v1/botAuth", maxRequests: 15 })) {
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

  const { botKeyId, secret, paymentAddress, stakeAddress } = req.body;

  if (typeof botKeyId !== "string" || typeof secret !== "string" || typeof paymentAddress !== "string") {
    return res.status(400).json({
      error: "Missing required fields: botKeyId, secret, paymentAddress",
    });
  }

  if (!paymentAddress || paymentAddress.length < 20) {
    return res.status(400).json({ error: "Invalid paymentAddress" });
  }

  const botKey = await db.botKey.findUnique({ where: { id: botKeyId } });
  if (!botKey) {
    return res.status(401).json({ error: "Invalid bot key" });
  }

  if (!verifyBotKeySecret(secret, botKey.keyHash)) {
    return res.status(401).json({ error: "Invalid bot key" });
  }

  const scopes = parseScope(botKey.scope);
  if (!scopeIncludes(scopes, MIN_SCOPE as BotScope)) {
    return res.status(403).json({ error: "Insufficient scope" });
  }

  const stake = typeof stakeAddress === "string" ? stakeAddress : null;

  const existingByAddress = await db.botUser.findUnique({ where: { paymentAddress } });
  if (existingByAddress && existingByAddress.botKeyId !== botKey.id) {
    return res.status(409).json({ error: "This address is already registered to another bot" });
  }

  const botUser = await db.botUser.upsert({
    where: { botKeyId: botKey.id },
    update: {
      paymentAddress,
      stakeAddress: stake,
    },
    create: {
      botKeyId: botKey.id,
      paymentAddress,
      stakeAddress: stake,
    },
  });

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not defined");
  }

  const token = sign(
    { address: botUser.paymentAddress, botId: botUser.id, type: "bot" as const },
    jwtSecret,
    { expiresIn: "1h" },
  );

  return res.status(200).json({ token, botId: botUser.id });
}
