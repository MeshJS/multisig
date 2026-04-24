import type { NextApiRequest, NextApiResponse } from "next";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { applyRateLimit, applyBotRateLimit } from "@/lib/security/requestGuards";
import { getProvider } from "@/utils/get-provider";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);
  if (!applyRateLimit(req, res, { keySuffix: "v1/stakeAccountInfo" })) return;
  await cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized - Missing token" });

  const payload = verifyJwt(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired token" });
  if (isBotJwt(payload) && !applyBotRateLimit(req, res, payload.botId)) return;

  const { stakeAddress } = req.query;
  if (typeof stakeAddress !== "string" || !stakeAddress.trim()) {
    return res.status(400).json({ error: "Missing or invalid stakeAddress parameter" });
  }

  const network = stakeAddress.startsWith("stake_test") ? 0 : 1;
  const provider = getProvider(network);

  try {
    const info = await provider.fetchAccountInfo(stakeAddress.trim());
    return res.status(200).json({ active: info.active, poolId: info.poolId ?? null });
  } catch (e) {
    // Blockfrost returns 404 for accounts that have never been registered — treat as inactive
    const is404 =
      (e as { status?: number })?.status === 404 ||
      (e instanceof Error && e.message.includes("404"));
    if (is404) {
      return res.status(200).json({ active: false, poolId: null });
    }
    console.error("stakeAccountInfo error:", e);
    return res.status(500).json({ error: "Failed to fetch stake account info" });
  }
}
