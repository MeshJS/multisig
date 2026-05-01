import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { env } from "@/env";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, applyBotRateLimit } from "@/lib/security/requestGuards";
import { authorizeProxyReadForV1, loadActiveProxyForWallet } from "@/lib/server/proxyAccess";
import { deriveProxyScripts } from "@/lib/server/proxyTxBuilders";
import type { UtxoRef } from "@/lib/server/proxyUtxos";

function getBlockfrostConfig(network: 0 | 1): { key: string; baseUrl: string } | null {
  if (network === 0) {
    const key = env.BLOCKFROST_API_KEY_PREPROD ?? env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD;
    if (!key) return null;
    return { key, baseUrl: "https://cardano-preprod.blockfrost.io/api/v0" };
  }
  const key = env.BLOCKFROST_API_KEY_MAINNET ?? env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET;
  if (!key) return null;
  return { key, baseUrl: "https://cardano-mainnet.blockfrost.io/api/v0" };
}

function parseParamUtxo(value: string): UtxoRef | null {
  try {
    const parsed = JSON.parse(value) as Partial<UtxoRef>;
    if (
      typeof parsed.txHash === "string" &&
      typeof parsed.outputIndex === "number" &&
      Number.isInteger(parsed.outputIndex)
    ) {
      return { txHash: parsed.txHash, outputIndex: parsed.outputIndex };
    }
  } catch {
    return null;
  }
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/proxyDRepInfo" })) {
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
  const proxyId = typeof req.query.proxyId === "string" ? req.query.proxyId : "";
  if (!walletId || !address || !proxyId) {
    return res.status(400).json({ error: "walletId, address, and proxyId are required" });
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

  let proxy;
  try {
    proxy = await loadActiveProxyForWallet({ db, walletId, proxyId });
  } catch (error) {
    return res.status(404).json({
      error: error instanceof Error ? error.message : "Proxy not found",
    });
  }

  const paramUtxo = parseParamUtxo(proxy.paramUtxo);
  if (!paramUtxo) {
    return res.status(500).json({ error: "Stored proxy paramUtxo is invalid" });
  }

  const network: 0 | 1 = address.includes("test") ? 0 : 1;
  const scripts = deriveProxyScripts({ paramUtxo, network });
  if (scripts.authTokenId !== proxy.authTokenId || scripts.proxyAddress !== proxy.proxyAddress) {
    return res.status(409).json({ error: "Stored proxy metadata does not match derived scripts" });
  }

  const config = getBlockfrostConfig(network);
  if (!config) {
    return res.status(500).json({ error: `Missing Blockfrost API key for network ${network}` });
  }

  try {
    const response = await fetch(`${config.baseUrl}/governance/dreps/${encodeURIComponent(scripts.dRepId)}`, {
      headers: { project_id: config.key },
    });

    if (response.status === 404) {
      return res.status(200).json({ active: false, dRepId: scripts.dRepId });
    }
    if (!response.ok) {
      const body = await response.text();
      console.error(`proxyDRepInfo Blockfrost error ${response.status}:`, body);
      return res.status(500).json({ error: `Blockfrost returned ${response.status}` });
    }

    const data = (await response.json()) as { active?: boolean };
    return res.status(200).json({ active: data.active === true, dRepId: scripts.dRepId });
  } catch (error) {
    console.error("proxyDRepInfo error:", error);
    return res.status(500).json({ error: "Failed to fetch proxy DRep info" });
  }
}
