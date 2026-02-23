import { NextApiRequest, NextApiResponse } from "next";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, applyBotRateLimit } from "@/lib/security/requestGuards";
import { getClientIP } from "@/lib/security/rateLimit";
import { getWalletIdsForBot } from "@/lib/auth/botAccess";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);
  
  if (!applyRateLimit(req, res, { keySuffix: "v1/walletIds" })) {
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

  const session = {
    user: { id: payload.address },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  const caller = createCaller({
    db,
    session,
    sessionAddress: payload.address,
    sessionWallets: [payload.address],
    primaryWallet: payload.address,
    ip: getClientIP(req),
  });

  const { address } = req.query;

  if (typeof address !== "string") {
    return res.status(400).json({ error: "Invalid address parameter" });
  }
  if (payload.address !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }

  try {
    let walletIds: { walletId: string; walletName: string }[];
    if (isBotJwt(payload)) {
      walletIds = await getWalletIdsForBot(db, payload.botId);
    } else {
      const caller = createCaller({
        db,
        session,
        sessionAddress: payload.address,
        sessionWallets: [payload.address],
        primaryWallet: payload.address,
        ip: getClientIP(req),
      });
      const wallets = await caller.wallet.getUserWallets({ address });
      if (!wallets) {
        return res.status(404).json({ error: "Wallets not found" });
      }
      walletIds = wallets.map((w) => ({ walletId: w.id, walletName: w.name }));
    }

    if (walletIds.length === 0) {
      return res.status(404).json({ error: "Wallets not found" });
    }

    res.setHeader("Cache-Control", "private, max-age=120, stale-while-revalidate=300");
    res.status(200).json(walletIds);
  } catch (error) {
    console.error("Error fetching wallet IDs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
