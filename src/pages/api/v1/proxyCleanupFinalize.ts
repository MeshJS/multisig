import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import {
  applyRateLimit,
  applyBotRateLimit,
  enforceBodySize,
} from "@/lib/security/requestGuards";
import { authorizeWalletSignerForV1Tx } from "@/lib/server/v1WalletAuth";
import { loadActiveProxyForWallet } from "@/lib/server/proxyAccess";
import { resolveWalletScriptAddress } from "@/lib/server/walletScriptAddress";
import { finalizeConfirmedProxyCleanup } from "@/lib/server/proxyCleanupFinalization";
import type { DbWalletWithLegacy } from "@/types/wallet";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/proxyCleanupFinalize" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!enforceBodySize(req, res, 100 * 1024)) {
    return;
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

  const body = req.body as {
    walletId?: string;
    address?: string;
    proxyId?: string;
    txHash?: string;
    deactivateProxy?: boolean;
  };

  const walletId = typeof body.walletId === "string" ? body.walletId : "";
  const address = typeof body.address === "string" ? body.address : "";
  const proxyId = typeof body.proxyId === "string" ? body.proxyId : "";
  const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
  if (!walletId || !address || !proxyId) {
    return res.status(400).json({ error: "walletId, address, and proxyId are required" });
  }
  if (!txHash) {
    return res.status(400).json({ error: "Missing required field txHash" });
  }

  let walletRow;
  try {
    const authorized = await authorizeWalletSignerForV1Tx(payload, walletId, address);
    walletRow = authorized.wallet;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "NOT_FOUND") {
      return res.status(404).json({ error: "Wallet not found" });
    }
    return res.status(403).json({
      error: error instanceof Error ? error.message : "Not authorized for this wallet",
    });
  }

  let proxy;
  try {
    proxy = await loadActiveProxyForWallet({ db, walletId, proxyId });
  } catch (error) {
    return res.status(404).json({
      error: error instanceof Error ? error.message : "Proxy not found",
    });
  }

  let walletAddress: string;
  try {
    walletAddress = resolveWalletScriptAddress(
      walletRow as DbWalletWithLegacy,
      address,
    );
  } catch (error) {
    return res.status(500).json({
      error:
        error instanceof Error ? error.message : "Wallet script address resolution failed",
    });
  }

  const network = address.includes("test") ? 0 : 1;
  const result = await finalizeConfirmedProxyCleanup({
    db,
    network,
    proxy,
    walletAddress,
    txHash,
    deactivateProxy: body.deactivateProxy,
  });

  if ("error" in result) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(201).json({ proxy: result.proxy, txHash });
}
