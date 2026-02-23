import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, applyBotRateLimit } from "@/lib/security/requestGuards";

/**
 * GET /api/v1/botMe - Returns the authenticated bot's own info including its owner's address.
 * Bot JWT only. Use this so the bot can discover "my owner's address" (e.g. for creating a 2-of-2 with the owner).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/botMe" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized - Missing token" });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  if (!isBotJwt(payload)) {
    return res.status(403).json({ error: "Only bot tokens can use this endpoint" });
  }

  if (!applyBotRateLimit(req, res, payload.botId)) {
    return;
  }

  const botUser = await db.botUser.findUnique({
    where: { id: payload.botId },
    include: { botKey: { select: { ownerAddress: true, name: true } } },
  });

  if (!botUser?.botKey) {
    return res.status(404).json({ error: "Bot not found" });
  }

  res.status(200).json({
    botId: botUser.id,
    paymentAddress: botUser.paymentAddress,
    displayName: botUser.displayName ?? null,
    botName: botUser.botKey.name,
    ownerAddress: botUser.botKey.ownerAddress,
  });
}
