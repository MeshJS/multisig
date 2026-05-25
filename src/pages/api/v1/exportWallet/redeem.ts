import type { NextApiRequest, NextApiResponse } from "next";
import { createHash } from "crypto";
import { db } from "@/server/db";
import { checkSignature, DataSignature } from "@meshsdk/core";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { nonceKey } from "./getNonce";

/**
 * Cross-instance export redeem.
 *
 * Verifies a CIP-30 DataSignature from a signer of the requested wallet,
 * then returns the wallet config payload that the destination instance
 * needs to recreate the wallet row. No transactions, signables, or other
 * derived state — only the deterministic config that resolves to the same
 * on-chain address.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (
    !applyRateLimit(req, res, {
      keySuffix: "v1/exportWallet/redeem",
      maxRequests: 20,
    })
  ) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).end();
  }

  if (!enforceBodySize(req, res, 64 * 1024)) return;

  const { address, walletId, signature, key } = req.body ?? {};
  if (
    typeof address !== "string" ||
    typeof walletId !== "string" ||
    typeof signature !== "string" ||
    typeof key !== "string"
  ) {
    return res
      .status(400)
      .json({ error: "Missing address, walletId, signature or key" });
  }

  const composite = nonceKey(walletId, address);
  const nonceEntry = await db.nonce.findFirst({ where: { address: composite } });
  if (!nonceEntry) {
    return res.status(400).json({ error: "No nonce issued" });
  }

  const sig: DataSignature = { signature, key };
  let isValid = false;
  try {
    isValid = await checkSignature(nonceEntry.value, sig, address);
  } catch (err) {
    console.error("[exportWallet/redeem] checkSignature threw:", err);
    isValid = false;
  }
  if (!isValid) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const wallet = await db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    await db.nonce.delete({ where: { id: nonceEntry.id } });
    return res.status(404).json({ error: "Wallet not found" });
  }

  const isSigner =
    wallet.signersStakeKeys.includes(address) ||
    wallet.signersAddresses.includes(address);
  if (!isSigner) {
    await db.nonce.delete({ where: { id: nonceEntry.id } });
    return res.status(403).json({ error: "Not a signer of this wallet" });
  }

  // Consume the nonce — every export round trip must re-prove ownership.
  await db.nonce.delete({ where: { id: nonceEntry.id } });

  const payload = {
    schemaVersion: 1 as const,
    id: wallet.id,
    name: wallet.name,
    description: wallet.description ?? "",
    signersAddresses: wallet.signersAddresses,
    signersStakeKeys: wallet.signersStakeKeys,
    signersDRepKeys: wallet.signersDRepKeys,
    signersDescriptions: wallet.signersDescriptions,
    numRequiredSigners: wallet.numRequiredSigners,
    scriptCbor: wallet.scriptCbor,
    stakeCredentialHash: wallet.stakeCredentialHash ?? null,
    type: wallet.type,
    rawImportBodies: wallet.rawImportBodies ?? null,
  };

  return res.status(200).json({
    payload,
    payloadHash: hashPayload(payload),
  });
}

/**
 * Stable integrity hash that the JSON-file tab uses to detect hand-edits.
 * Binds the digest to the wallet id + scriptCbor so a payload "stolen"
 * from one wallet can't be relabeled as another.
 */
export function hashPayload(payload: {
  id: string;
  scriptCbor: string;
  [k: string]: unknown;
}): string {
  return createHash("sha256")
    .update(
      `${payload.id}:${payload.scriptCbor}:${canonicalJson(payload)}`,
    )
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}
