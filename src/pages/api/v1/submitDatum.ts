import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { DataSignature } from "@meshsdk/core";
import { checkSignature } from "@meshsdk/core-cst";
import { applyRateLimit, applyBotRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { assertBotWalletAccess } from "@/lib/auth/botAccess";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);
  
  if (!applyRateLimit(req, res, { keySuffix: "v1/submitDatum" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!enforceBodySize(req, res, 128 * 1024)) {
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
    signature,
    key,
    address,
    datum,
    callbackUrl,
    description = "External Tx",
  } = req.body;

  if (!walletId) {
    return res.status(400).json({ error: "Missing required field walletId!" });
  }
  if (!signature) {
    return res.status(400).json({ error: "Missing required field signature!" });
  }
  if (!signature) {
    return res.status(400).json({ error: "Missing required field key!" });
  }
  if (!address) {
    return res.status(400).json({ error: "Missing required field address!" });
  }
  // Optionally check that the address matches the session user.id for security
  if (session.user.id !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }
  if (!datum) {
    return res.status(400).json({ error: "Missing required field Datum!" });
  }
  if (!callbackUrl) {
    return res.status(400).json({ error: "Missing required field Datum!" });
  }

  const sig: DataSignature = { signature: signature, key: key };

  const isValid = await checkSignature(datum, sig, address);

  if (!isValid) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  let wallet: { id: string } | null;
  if (isBotJwt(payload)) {
    try {
      const result = await assertBotWalletAccess(db, walletId, payload, true);
      wallet = result.wallet;
    } catch {
      return res.status(403).json({ error: "Not authorized for this wallet" });
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

  try {
    const newSignable = await db.signable.create({
      data: {
        walletId,
        payload: datum,
        signatures: [`signature: ${sig.signature}, key: ${sig.key}`],
        signedAddresses: [address],
        rejectedAddresses: [],
        description,
        callbackUrl: callbackUrl || null,
        remoteOrigin: req.headers.origin || null,
        state: 0,
      },
    });

    res.status(201).json(newSignable);
  } catch (error) {
    console.error("Error creating signable:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
