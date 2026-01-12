import type { NextApiRequest, NextApiResponse } from "next";

import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { verifyJwt } from "@/lib/verifyJwt";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { getProvider } from "@/utils/get-provider";
import { addressToNetwork } from "@/utils/multisigSDK";
import { resolvePaymentKeyHash } from "@meshsdk/core";
import { csl, calculateTxHash } from "@meshsdk/core-csl";
import { applyRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { getClientIP } from "@/lib/security/rateLimit";

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
  };

  const {
    walletId,
    transactionId,
    address,
    signature,
    key,
    broadcast: rawBroadcast,
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

    let parsedStoredTx: ReturnType<typeof csl.Transaction.from_hex>;
    try {
      parsedStoredTx = csl.Transaction.from_hex(storedTxHex);
    } catch (error: unknown) {
      console.error("Failed to parse stored transaction", toError(error));
      return res.status(500).json({ error: "Invalid stored transaction data" });
    }

    const txBodyClone = csl.TransactionBody.from_bytes(
      parsedStoredTx.body().to_bytes(),
    );
    const witnessSetClone = csl.TransactionWitnessSet.from_bytes(
      parsedStoredTx.witness_set().to_bytes(),
    );

    let vkeyWitnesses = witnessSetClone.vkeys();
    if (!vkeyWitnesses) {
      vkeyWitnesses = csl.Vkeywitnesses.new();
      witnessSetClone.set_vkeys(vkeyWitnesses);
    } else {
      vkeyWitnesses = csl.Vkeywitnesses.from_bytes(vkeyWitnesses.to_bytes());
      witnessSetClone.set_vkeys(vkeyWitnesses);
    }

    const signatureHex = normalizeHex(signature, "signature");
    const keyHex = normalizeHex(key, "key");

    let witnessPublicKey: csl.PublicKey;
    let witnessSignature: csl.Ed25519Signature;
    let witnessToAdd: csl.Vkeywitness;

    try {
      witnessPublicKey = csl.PublicKey.from_hex(keyHex);
      witnessSignature = csl.Ed25519Signature.from_hex(signatureHex);
      const vkey = csl.Vkey.new(witnessPublicKey);
      witnessToAdd = csl.Vkeywitness.new(vkey, witnessSignature);
    } catch (error: unknown) {
      console.error("Invalid signature payload", toError(error));
      return res.status(400).json({ error: "Invalid signature payload" });
    }

    const witnessKeyHash = toHex(witnessPublicKey.hash().to_bytes()).toLowerCase();

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

    const txHashHex = calculateTxHash(parsedStoredTx.to_hex()).toLowerCase();
    const txHashBytes = Buffer.from(txHashHex, "hex");
    const isSignatureValid = witnessPublicKey.verify(txHashBytes, witnessSignature);

    if (!isSignatureValid) {
      return res.status(401).json({ error: "Invalid signature for transaction" });
    }

    const existingWitnessCount = vkeyWitnesses.len();
    for (let i = 0; i < existingWitnessCount; i++) {
      const existingWitness = vkeyWitnesses.get(i);
      const existingKeyHash = toHex(
        existingWitness.vkey().public_key().hash().to_bytes(),
      ).toLowerCase();
      if (existingKeyHash === witnessKeyHash) {
        return res
          .status(409)
          .json({ error: "Witness for this address already exists" });
      }
    }

    vkeyWitnesses.add(witnessToAdd);

    const updatedTx = csl.Transaction.new(
      txBodyClone,
      witnessSetClone,
      parsedStoredTx.auxiliary_data(),
    );
    if (!parsedStoredTx.is_valid()) {
      updatedTx.set_is_valid(false);
    }
    const txHexForUpdate = updatedTx.to_hex();

    const witnessSummaries: {
      keyHashHex: string;
      publicKeyBech32: string;
      signatureHex: string;
    }[] = [];
    const witnessSetForExport = csl.Vkeywitnesses.from_bytes(
      vkeyWitnesses.to_bytes(),
    );
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

    const threshold = (() => {
      switch (wallet.type) {
        case "atLeast":
          return wallet.numRequiredSigners ?? wallet.signersAddresses.length;
        case "all":
          return wallet.signersAddresses.length;
        case "any":
          return 1;
        default:
          return wallet.numRequiredSigners ?? 1;
      }
    })();

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
      threshold > 0 &&
      updatedSignedAddresses.length >= threshold
    ) {
      try {
        const network = resolveNetworkId();
        const provider = getProvider(network);
        const submittedHash = await provider.submitTx(txHexForUpdate);
        finalTxHash = submittedHash;
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
