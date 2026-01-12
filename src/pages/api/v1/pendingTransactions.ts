import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { verifyJwt } from "@/lib/verifyJwt";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import type { NextApiRequest, NextApiResponse } from "next";
import { applyRateLimit } from "@/lib/security/requestGuards";
import { getClientIP } from "@/lib/security/rateLimit";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/pendingTransactions" })) {
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

  const session = {
    user: { id: payload.address },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  } as const;

  const { walletId, address } = req.query;

  if (typeof address !== "string") {
    return res.status(400).json({ error: "Invalid address parameter" });
  }
  if (payload.address !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }
  if (typeof walletId !== "string") {
    return res.status(400).json({ error: "Invalid walletId parameter" });
  }

  try {
    const caller = createCaller({
      db,
      session,
      sessionAddress: payload.address,
      sessionWallets: [payload.address],
      primaryWallet: payload.address,
      ip: getClientIP(req),
    });

    const wallet = await caller.wallet.getWallet({ walletId, address });
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const pendingTransactions =
      await caller.transaction.getPendingTransactions({ walletId });

    return res.status(200).json(pendingTransactions);
  } catch (error) {
    console.error("Error in pendingTransactions handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

