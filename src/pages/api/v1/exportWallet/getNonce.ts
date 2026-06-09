import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit } from "@/lib/security/requestGuards";

/**
 * Cross-instance export nonce.
 *
 * Issues a nonce bound to (address, walletId) so the importer can prove
 * with their CIP-30 wallet that they are a signer on this wallet before
 * the origin releases its config payload.
 *
 * Storage shares the existing Nonce table, keyed by a composite
 * "export:{walletId}:{address}" address string. The standard login nonce
 * (just `address`) is unaffected because it uses a different key.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/exportWallet/getNonce" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).end();
  }

  try {
    const { address, walletId } = req.query;
    if (typeof address !== "string" || typeof walletId !== "string") {
      return res.status(400).json({ error: "Missing address or walletId" });
    }

    const wallet = await db.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const isSigner =
      wallet.signersStakeKeys.includes(address) ||
      wallet.signersAddresses.includes(address);
    if (!isSigner) {
      return res
        .status(403)
        .json({ error: "Address is not a signer of this wallet" });
    }

    const compositeKey = nonceKey(walletId, address);
    const existing = await db.nonce.findFirst({
      where: { address: compositeKey },
    });
    if (existing) {
      return res.status(200).json({ nonce: existing.value });
    }

    const nonce = randomBytes(16).toString("hex");
    await db.nonce.create({
      data: { address: compositeKey, value: nonce },
    });
    return res.status(200).json({ nonce });
  } catch (error) {
    console.error("[exportWallet/getNonce] Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

export function nonceKey(walletId: string, address: string): string {
  return `export:${walletId}:${address}`;
}
