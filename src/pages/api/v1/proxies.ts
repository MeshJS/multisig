import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, applyBotRateLimit } from "@/lib/security/requestGuards";
import { authorizeProxyReadForV1 } from "@/lib/server/proxyAccess";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/proxies" })) {
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

  if (isBotJwt(payload) && !applyBotRateLimit(req, res, payload.botId)) {
    return;
  }

  const walletId = typeof req.query.walletId === "string" ? req.query.walletId : "";
  const address = typeof req.query.address === "string" ? req.query.address : "";
  if (!walletId) {
    return res.status(400).json({ error: "Invalid walletId parameter" });
  }
  if (!address) {
    return res.status(400).json({ error: "Invalid address parameter" });
  }

  try {
    await authorizeProxyReadForV1({ db, payload, walletId, address });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "NOT_FOUND") {
      return res.status(404).json({ error: "Wallet not found" });
    }
    return res.status(403).json({
      error: error instanceof Error ? error.message : "Not authorized for this wallet",
    });
  }

  const proxies = await db.proxy.findMany({
    where: {
      walletId,
      isActive: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return res.status(200).json(proxies);
}
