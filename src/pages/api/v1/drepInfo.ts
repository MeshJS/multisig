import type { NextApiRequest, NextApiResponse } from "next";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { applyRateLimit, applyBotRateLimit } from "@/lib/security/requestGuards";
import { db } from "@/server/db";
import { buildMultisigWallet, buildWallet, getWalletType } from "@/utils/common";
import { env } from "@/env";
import type { DbWalletWithLegacy } from "@/types/wallet";

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);
  if (!applyRateLimit(req, res, { keySuffix: "v1/drepInfo" })) return;
  await cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized - Missing token" });

  const payload = verifyJwt(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired token" });
  if (isBotJwt(payload) && !applyBotRateLimit(req, res, payload.botId)) return;

  const { walletId, address } = req.query;
  if (typeof walletId !== "string" || !walletId.trim()) {
    return res.status(400).json({ error: "Missing or invalid walletId parameter" });
  }
  if (typeof address !== "string" || !address.trim()) {
    return res.status(400).json({ error: "Missing or invalid address parameter" });
  }

  const walletRow = await db.wallet.findUnique({ where: { id: walletId } });
  if (!walletRow) return res.status(404).json({ error: "Wallet not found" });

  const wallet = walletRow as DbWalletWithLegacy;
  const wt = getWalletType(wallet);
  if (wt === "summon") {
    return res.status(400).json({ error: "DRep certificates are not supported for Summon wallets" });
  }

  const network: 0 | 1 = address.includes("test") ? 0 : 1;
  const appWallet = buildWallet(wallet, network);
  const multisigWallet = buildMultisigWallet(wallet);

  let dRepId: string | undefined;
  if (multisigWallet) {
    const drepData = multisigWallet.getDRep(appWallet);
    dRepId = drepData?.dRepId;
  } else {
    dRepId = appWallet.dRepId ?? undefined;
  }

  if (!dRepId) {
    return res.status(400).json({ error: "DRep is not configured for this wallet" });
  }

  const config = getBlockfrostConfig(network);
  if (!config) {
    return res.status(500).json({ error: `Missing Blockfrost API key for network ${network}` });
  }

  try {
    const response = await fetch(`${config.baseUrl}/governance/dreps/${encodeURIComponent(dRepId)}`, {
      headers: { project_id: config.key },
    });

    if (response.status === 404) {
      return res.status(200).json({ active: false, dRepId });
    }
    if (!response.ok) {
      const body = await response.text();
      console.error(`drepInfo Blockfrost error ${response.status}:`, body);
      return res.status(500).json({ error: `Blockfrost returned ${response.status}` });
    }

    const data = (await response.json()) as { active?: boolean };
    return res.status(200).json({ active: data.active === true, dRepId });
  } catch (e) {
    console.error("drepInfo error:", e);
    return res.status(500).json({ error: "Failed to fetch DRep info" });
  }
}
