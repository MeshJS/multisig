import type { NextApiRequest, NextApiResponse } from "next";

import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { verifyJwt } from "@/lib/verifyJwt";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { getProvider } from "@/utils/get-provider";
import { addressToNetwork } from "@/utils/multisigSDK";
import { resolvePaymentKeyHash } from "@meshsdk/core";
import { csl, calculateTxHash } from "@meshsdk/core-csl";

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

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
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
    txHash?: unknown;
  };

  const {
    walletId,
    transactionId,
    address,
    signature,
    key,
    broadcast: rawBroadcast,
    txHash: rawTxHash,
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
    const caller = createCaller({ db, session });

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

    const txHashHex = calculateTxHash(parsedStoredTx.to_hex());
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

    const providedTxHash =
      typeof rawTxHash === "string" && rawTxHash.trim() !== ""
        ? rawTxHash.trim()
        : undefined;

    let nextState = transaction.state;
    let finalTxHash = providedTxHash ?? transaction.txHash ?? undefined;
    let submissionError: string | undefined;

    if (
      shouldAttemptBroadcast &&
      threshold > 0 &&
      updatedSignedAddresses.length >= threshold &&
      !providedTxHash
    ) {
      try {
        const networkSource = wallet.signersAddresses[0] ?? address;
        const network = addressToNetwork(networkSource);
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

    if (providedTxHash) {
      nextState = 1;
    }

    if (transaction.state === 1) {
      nextState = 1;
    } else if (nextState !== 1) {
      nextState = 0;
    }

    const updatedTransaction = await caller.transaction.updateTransaction({
      transactionId,
      txCbor: txHexForUpdate,
      signedAddresses: updatedSignedAddresses,
      rejectedAddresses: transaction.rejectedAddresses,
      state: nextState,
      ...(finalTxHash ? { txHash: finalTxHash } : {}),
    });

    return res.status(200).json({
      transaction: updatedTransaction,
      submitted: nextState === 1,
      txHash: finalTxHash,
      ...(submissionError ? { submissionError } : {}),
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
