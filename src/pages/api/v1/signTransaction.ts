import type { NextApiRequest, NextApiResponse } from "next";

import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { getProvider } from "@/utils/get-provider";
import { addressToNetwork } from "@/utils/multisigSDK";
import {
  addUniqueVkeyWitnessToTx,
  createVkeyWitnessFromHex,
  shouldSubmitMultisigTx,
  submitTxWithScriptRecovery,
} from "@/utils/txSignUtils";
import { resolvePaymentKeyHash, resolveStakeKeyHash } from "@meshsdk/core";
import { calculateTxHash } from "@meshsdk/core-csl";
import { applyRateLimit, applyBotRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { getClientIP } from "@/lib/security/rateLimit";
import { getBotWalletAccess } from "@/lib/auth/botAccess";

function coerceBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function normalizeHex(value: string, context: string): string {
  const trimmed = value.trim().toLowerCase().replace(/^0x/, "");
  if (trimmed.length === 0 || trimmed.length % 2 !== 0 || !/^[0-9a-f]+$/.test(trimmed)) {
    throw new Error(`Invalid ${context} hex string`);
  }
  return trimmed;
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/signTransaction" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!enforceBodySize(req, res, 256 * 1024)) {
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

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
  } as const;

  type SignTransactionRequestBody = {
    walletId?: unknown;
    transactionId?: unknown;
    address?: unknown;
    signature?: unknown;
    key?: unknown;
    broadcast?: unknown;
    /** Optional stake-key witness for transactions that include a staking certificate. */
    stakeKey?: unknown;
    stakeSignature?: unknown;
  };

  const {
    walletId,
    transactionId,
    address,
    signature,
    key,
    broadcast: rawBroadcast,
    stakeKey,
    stakeSignature,
  } = (req.body ?? {}) as SignTransactionRequestBody;

  if (typeof walletId !== "string" || walletId.trim() === "") {
    return res.status(400).json({ error: "Missing or invalid walletId" });
  }

  if (typeof transactionId !== "string" || transactionId.trim() === "") {
    return res
      .status(400)
      .json({ error: "Missing or invalid transactionId" });
  }

  if (typeof address !== "string" || address.trim() === "") {
    return res.status(400).json({ error: "Missing or invalid address" });
  }

  if (typeof signature !== "string" || signature.trim() === "") {
    return res.status(400).json({ error: "Missing or invalid signature" });
  }

  if (typeof key !== "string" || key.trim() === "") {
    return res.status(400).json({ error: "Missing or invalid key" });
  }

  if (payload.address !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }

  try {
    let wallet: Awaited<ReturnType<ReturnType<typeof createCaller>["wallet"]["getWallet"]>>;
    if (isBotJwt(payload)) {
      const access = await getBotWalletAccess(db, walletId, payload.botId);
      if (!access.allowed || access.role !== "cosigner") {
        return res.status(403).json({ error: "Not authorized for this wallet" });
      }
      const w = await db.wallet.findUnique({ where: { id: walletId } });
      if (!w || !w.signersAddresses.includes(address)) {
        return res.status(403).json({ error: "Wallet not found or address not a signer" });
      }
      wallet = w;
    } else {
      const caller = createCaller({
        db,
        session,
        sessionAddress: payload.address,
        sessionWallets: [payload.address],
        primaryWallet: payload.address,
        ip: getClientIP(req),
      });
      wallet = await caller.wallet.getWallet({ walletId, address });
    }
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const transaction = await db.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    if (transaction.walletId !== walletId) {
      return res
        .status(403)
        .json({ error: "Transaction does not belong to wallet" });
    }

    if (transaction.state === 1) {
      return res
        .status(409)
        .json({ error: "Transaction already finalized" });
    }

    if (transaction.signedAddresses.includes(address)) {
      return res
        .status(409)
        .json({ error: "Address has already signed this transaction" });
    }

    if (transaction.rejectedAddresses.includes(address)) {
      return res
        .status(409)
        .json({ error: "Address has already rejected this transaction" });
    }

    const updatedSignedAddresses = Array.from(
      new Set([...transaction.signedAddresses, address]),
    );

    const storedTxHex = transaction.txCbor?.trim();
    if (!storedTxHex) {
      return res.status(500).json({ error: "Stored transaction is missing txCbor" });
    }

    const signatureHex = normalizeHex(signature, "signature");
    const keyHex = normalizeHex(key, "key");

    let witnessPublicKey: ReturnType<typeof createVkeyWitnessFromHex>["publicKey"];
    let witnessSignature: ReturnType<typeof createVkeyWitnessFromHex>["signature"];
    let witnessToAdd: ReturnType<typeof createVkeyWitnessFromHex>["witness"];
    let witnessKeyHash: string;

    try {
      const witnessDetails = createVkeyWitnessFromHex(keyHex, signatureHex);
      witnessPublicKey = witnessDetails.publicKey;
      witnessSignature = witnessDetails.signature;
      witnessToAdd = witnessDetails.witness;
      witnessKeyHash = witnessDetails.keyHashHex;
    } catch (error: unknown) {
      console.error("Invalid signature payload", toError(error));
      return res.status(400).json({ error: "Invalid signature payload" });
    }

    let addressKeyHash: string;
    try {
      addressKeyHash = resolvePaymentKeyHash(address).toLowerCase();
    } catch (error: unknown) {
      console.error("Unable to resolve payment key hash", toError(error));
      return res.status(400).json({ error: "Invalid address format" });
    }

    if (addressKeyHash !== witnessKeyHash) {
      return res
        .status(403)
        .json({ error: "Signature public key does not match address" });
    }

    let txHashHex: string;
    try {
      txHashHex = calculateTxHash(storedTxHex).toLowerCase();
    } catch (error: unknown) {
      console.error("Failed to hash stored transaction", toError(error));
      return res.status(500).json({ error: "Invalid stored transaction data" });
    }

    const txHashBytes = Buffer.from(txHashHex, "hex");
    const isSignatureValid = witnessPublicKey.verify(txHashBytes, witnessSignature);

    if (!isSignatureValid) {
      return res.status(401).json({ error: "Invalid signature for transaction" });
    }

    // ── Optional stake-key witness ──────────────────────────────────────────
    // Submitted alongside the payment-key witness when the transaction contains
    // a staking certificate whose script uses stake key hashes (role-2 keys).
    // The signer's stake key hash must belong to this wallet's signersStakeKeys.
    let stakeWitnessToAdd: ReturnType<typeof createVkeyWitnessFromHex>["witness"] | null = null;

    const rawStakeKey = typeof stakeKey === "string" ? stakeKey.trim() : "";
    const rawStakeSignature = typeof stakeSignature === "string" ? stakeSignature.trim() : "";

    if (rawStakeKey && rawStakeSignature) {
      let stakeWitnessDetails: ReturnType<typeof createVkeyWitnessFromHex>;
      try {
        stakeWitnessDetails = createVkeyWitnessFromHex(
          normalizeHex(rawStakeKey, "stakeKey"),
          normalizeHex(rawStakeSignature, "stakeSignature"),
        );
      } catch (error: unknown) {
        console.error("Invalid stake witness payload", toError(error));
        return res.status(400).json({ error: "Invalid stake witness payload" });
      }

      const isStakeSigValid = stakeWitnessDetails.publicKey.verify(
        txHashBytes,
        stakeWitnessDetails.signature,
      );
      if (!isStakeSigValid) {
        return res.status(401).json({ error: "Invalid stake signature for transaction" });
      }

      // Resolve all staking key hashes for this wallet and check membership.
      const walletStakeRow = await db.wallet.findUnique({
        where: { id: walletId },
        select: { signersStakeKeys: true },
      });
      const validStakeKeyHashes = new Set<string>();
      for (const stakeAddr of (walletStakeRow?.signersStakeKeys ?? [])) {
        if (typeof stakeAddr === "string" && stakeAddr.trim()) {
          try {
            validStakeKeyHashes.add(resolveStakeKeyHash(stakeAddr).toLowerCase());
          } catch {
            // skip malformed stake address
          }
        }
      }
      if (!validStakeKeyHashes.has(stakeWitnessDetails.keyHashHex)) {
        return res.status(403).json({ error: "Stake key is not a staking key for this wallet" });
      }

      stakeWitnessToAdd = stakeWitnessDetails.witness;
    }

    let txHexForUpdate = storedTxHex;
    let vkeyWitnesses: ReturnType<typeof addUniqueVkeyWitnessToTx>["vkeyWitnesses"];
    try {
      const mergeResult = addUniqueVkeyWitnessToTx(storedTxHex, witnessToAdd);
      if (!mergeResult.witnessAdded) {
        return res
          .status(409)
          .json({ error: "Witness for this address already exists" });
      }
      txHexForUpdate = mergeResult.txHex;
      vkeyWitnesses = mergeResult.vkeyWitnesses;
    } catch (error: unknown) {
      console.error("Failed to merge witness into transaction", toError(error));
      return res.status(500).json({ error: "Invalid stored transaction data" });
    }

    // Merge stake witness into the tx if one was provided and validated.
    if (stakeWitnessToAdd) {
      try {
        const stakeMerge = addUniqueVkeyWitnessToTx(txHexForUpdate, stakeWitnessToAdd);
        txHexForUpdate = stakeMerge.txHex;
        vkeyWitnesses = stakeMerge.vkeyWitnesses;
      } catch (error: unknown) {
        console.error("Failed to merge stake witness into transaction", toError(error));
        return res.status(500).json({ error: "Failed to add stake witness to transaction" });
      }
    }

    const witnessSummaries: {
      keyHashHex: string;
      publicKeyBech32: string;
      signatureHex: string;
    }[] = [];
    const witnessSetForExport = vkeyWitnesses;
    const witnessCountForExport = witnessSetForExport.len();
    for (let i = 0; i < witnessCountForExport; i++) {
      const witness = witnessSetForExport.get(i);
      witnessSummaries.push({
        keyHashHex: toHex(
          witness.vkey().public_key().hash().to_bytes(),
        ).toLowerCase(),
        publicKeyBech32: witness.vkey().public_key().to_bech32(),
        signatureHex: toHex(witness.signature().to_bytes()).toLowerCase(),
      });
    }

    const shouldAttemptBroadcast = coerceBoolean(rawBroadcast, true);

    let nextState = transaction.state;
    let finalTxHash = transaction.txHash ?? undefined;
    let submissionError: string | undefined;

    const resolveNetworkId = (): number => {
      const candidateAddresses = Array.isArray(wallet.signersAddresses)
        ? wallet.signersAddresses
        : [];

      for (const candidate of candidateAddresses) {
        if (typeof candidate !== "string") {
          continue;
        }
        const trimmed = candidate.trim();
        if (!trimmed) {
          continue;
        }
        try {
          return addressToNetwork(trimmed);
        } catch (error: unknown) {
          console.warn("Unable to resolve network from wallet signer address", {
            walletId,
            candidate: trimmed,
            error: toError(error),
          });
        }
      }

      throw new Error("Unable to determine network from wallet data");
    };

    if (
      shouldAttemptBroadcast &&
      shouldSubmitMultisigTx(wallet, updatedSignedAddresses.length)
    ) {
      try {
        const network = resolveNetworkId();
        const provider = getProvider(network);
        const submitResult = await submitTxWithScriptRecovery({
          txHex: txHexForUpdate,
          submitter: provider,
          appWallet: wallet,
          network,
        });
        finalTxHash = submitResult.txHash;
        txHexForUpdate = submitResult.txHex;
        nextState = 1;
      } catch (error: unknown) {
        const err = toError(error);
        console.error("Error submitting signed transaction", {
          transactionId,
          error: err,
        });
        submissionError = err.message ?? "Failed to submit transaction";
      }
    }

    if (transaction.state === 1) {
      nextState = 1;
    } else if (nextState !== 1) {
      nextState = 0;
    }

    let txJsonForUpdate = transaction.txJson;
    try {
      const parsedTxJson = JSON.parse(
        transaction.txJson,
      ) as Record<string, unknown>;
      const enrichedTxJson = {
        ...parsedTxJson,
        multisig: {
          state: nextState,
          submitted: nextState === 1,
          signedAddresses: updatedSignedAddresses,
          rejectedAddresses: transaction.rejectedAddresses,
          witnesses: witnessSummaries,
          txHash: (finalTxHash ?? txHashHex).toLowerCase(),
          bodyHash: txHashHex,
          submissionError: submissionError ?? null,
        },
      };
      txJsonForUpdate = JSON.stringify(enrichedTxJson);
    } catch (error: unknown) {
      const err = toError(error);
      console.warn("Unable to update txJson snapshot", {
        transactionId,
        error: err,
      });
    }

    const updateData: {
      signedAddresses: { set: string[] };
      rejectedAddresses: { set: string[] };
      txCbor: string;
      txJson: string;
      state: number;
      txHash?: string;
    } = {
      signedAddresses: { set: updatedSignedAddresses },
      rejectedAddresses: { set: transaction.rejectedAddresses },
      txCbor: txHexForUpdate,
      txJson: txJsonForUpdate,
      state: nextState,
    };

    if (finalTxHash) {
      updateData.txHash = finalTxHash;
    }

    const updateResult = await db.transaction.updateMany({
      where: {
        id: transactionId,
        signedAddresses: { equals: transaction.signedAddresses },
        rejectedAddresses: { equals: transaction.rejectedAddresses },
        txCbor: transaction.txCbor ?? "",
        txJson: transaction.txJson,
      },
      data: updateData,
    });

    if (updateResult.count === 0) {
      const latest = await db.transaction.findUnique({
        where: { id: transactionId },
      });

      return res.status(409).json({
        error: "Transaction was updated by another signer. Please refresh and try again.",
        ...(latest ? { transaction: latest } : {}),
      });
    }

    const updatedTransaction = await db.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!updatedTransaction) {
      return res.status(500).json({ error: "Failed to load updated transaction state" });
    }

    if (submissionError) {
      return res.status(502).json({
        error: "Transaction witness recorded, but submission to network failed",
        transaction: updatedTransaction,
        submitted: false,
        txHash: finalTxHash,
        submissionError,
      });
    }

    return res.status(200).json({
      transaction: updatedTransaction,
      submitted: nextState === 1,
      txHash: finalTxHash,
    });
  } catch (error: unknown) {
    const err = toError(error);
    console.error("Error in signTransaction handler", {
      message: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
