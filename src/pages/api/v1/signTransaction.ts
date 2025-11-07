import type { NextApiRequest, NextApiResponse } from "next";

import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { verifyJwt } from "@/lib/verifyJwt";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { getProvider } from "@/utils/get-provider";
import { addressToNetwork } from "@/utils/multisigSDK";

function coerceBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
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
    txCbor?: unknown;
    broadcast?: unknown;
    txHash?: unknown;
  };

  const {
    walletId,
    transactionId,
    address,
    txCbor,
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

  if (typeof txCbor !== "string" || txCbor.trim() === "") {
    return res.status(400).json({ error: "Missing or invalid txCbor" });
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

    const updatedSignedAddresses = [
      ...transaction.signedAddresses,
      address,
    ];

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
        const submittedHash = await provider.submitTx(txCbor);
        finalTxHash = submittedHash;
        nextState = 1;
      } catch (error) {
        console.error("Error submitting signed transaction", {
          transactionId,
          error,
        });
        submissionError = (error as Error)?.message ?? "Failed to submit transaction";
      }
    }

    if (providedTxHash) {
      nextState = 1;
    }

    // Ensure we do not downgrade a completed transaction back to pending
    if (transaction.state === 1) {
      nextState = 1;
    } else if (nextState !== 1) {
      nextState = 0;
    }

    const updatedTransaction = await caller.transaction.updateTransaction({
      transactionId,
      txCbor,
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
  } catch (error) {
    console.error("Error in signTransaction handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
