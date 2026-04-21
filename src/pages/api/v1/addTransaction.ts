import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, applyBotRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { assertBotWalletAccess } from "@/lib/auth/botAccess";
import { createPendingMultisigTransaction } from "@/lib/server/createPendingMultisigTransaction";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/addTransaction" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!enforceBodySize(req, res, 200 * 1024)) {
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

  const session = {
    user: { id: payload.address },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  const {
    walletId,
    address,
    txCbor,
    txJson,
    description = "External Tx",
    callbackUrl,
  } = req.body;

  if (!walletId) {
    return res.status(400).json({ error: "Missing required field walletId!" });
  }
  if (!address) {
    return res.status(400).json({ error: "Missing required field address!" });
  }
  if (session.user.id !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }
  if (!txCbor) {
    return res.status(400).json({ error: "Missing required field txCbor!" });
  }
  if (!txJson) {
    return res.status(400).json({ error: "Missing required field txJson!" });
  }

  let wallet: { id: string; signersAddresses: string[]; numRequiredSigners: number | null; type: string };
  if (isBotJwt(payload)) {
    try {
      const result = await assertBotWalletAccess(db, walletId, payload, true);
      wallet = result.wallet;
    } catch (err) {
      return res.status(403).json({ error: err instanceof Error ? err.message : "Not authorized for this wallet" });
    }
  } else {
    const w = await db.wallet.findUnique({ where: { id: walletId } });
    const signers = w?.signersAddresses ?? [];
    const isSigner = Array.isArray(signers) && signers.includes(address);
    if (!w || !isSigner) {
      return res.status(403).json({ error: "Not authorized for this wallet" });
    }
    wallet = w;
  }

  const reqSigners = wallet.numRequiredSigners;
  const type = wallet.type;
  const network = address.includes("test") ? 0 : 1;

  try {
    const newTx = await createPendingMultisigTransaction(db, {
      walletId,
      wallet: { numRequiredSigners: reqSigners, type },
      proposerAddress: address,
      txCbor,
      txJson,
      description,
      network,
    });

    res.status(201).json(newTx);
  } catch (error) {
    console.error("Error creating transaction:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
