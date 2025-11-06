import type { NextApiRequest, NextApiResponse } from "next";

import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { verifyJwt } from "@/lib/verifyJwt";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { getProvider } from "@/utils/get-provider";
import { paymentKeyHash } from "@/utils/multisigSDK";
import { csl } from "@meshsdk/core-csl";

const HEX_REGEX = /^[0-9a-fA-F]+$/;

const isHexString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && HEX_REGEX.test(value);

const resolveNetworkFromAddress = (bech32Address: string): 0 | 1 =>
  bech32Address.startsWith("addr_test") || bech32Address.startsWith("stake_test")
    ? 0
    : 1;

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
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

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

  const caller = createCaller({ db, session });

  const body =
    typeof req.body === "object" && req.body !== null
      ? (req.body as Record<string, unknown>)
      : {};

  const { walletId, transactionId, address, signedTx } = body;

  if (typeof walletId !== "string" || walletId.trim().length === 0) {
    return res.status(400).json({ error: "Missing or invalid walletId" });
  }

  if (typeof transactionId !== "string" || transactionId.trim().length === 0) {
    return res
      .status(400)
      .json({ error: "Missing or invalid transactionId" });
  }

  if (typeof address !== "string" || address.trim().length === 0) {
    return res.status(400).json({ error: "Missing or invalid address" });
  }

  if (!isHexString(signedTx)) {
    return res.status(400).json({ error: "Missing or invalid signedTx" });
  }

  if (signedTx.length % 2 !== 0) {
    return res.status(400).json({ error: "Missing or invalid signedTx" });
  }

  if (payload.address !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }

  try {
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
        .json({ error: "Address already signed this transaction" });
    }

    if (transaction.rejectedAddresses.includes(address)) {
      return res
        .status(409)
        .json({ error: "Address has rejected this transaction" });
    }

    let signerKeyHash: string;
    try {
      signerKeyHash = paymentKeyHash(address).toLowerCase();
    } catch (deriveError) {
      console.error("Failed to derive payment key hash", {
        message: (deriveError as Error)?.message,
      });
      return res.status(400).json({ error: "Unable to derive signer key" });
    }

    let signerWitnessFound = false;
    try {
      const tx = csl.Transaction.from_hex(signedTx);
      const vkeys = tx.witness_set()?.vkeys();

      if (vkeys) {
        for (let i = 0; i < vkeys.len(); i += 1) {
          const witness = vkeys.get(i);
          const witnessKeyHash = Buffer.from(
            witness.vkey().public_key().hash().to_bytes(),
          )
            .toString("hex")
            .toLowerCase();

          if (witnessKeyHash === signerKeyHash) {
            signerWitnessFound = true;
            break;
          }
        }
      }
    } catch (decodeError) {
      console.error("Failed to inspect transaction witnesses", {
        message: (decodeError as Error)?.message,
        stack: (decodeError as Error)?.stack,
      });
      return res.status(400).json({ error: "Invalid signedTx payload" });
    }

    if (!signerWitnessFound) {
      return res.status(400).json({
        error: "Signed transaction does not include caller signature",
      });
    }

    const updatedSignedAddresses = [...transaction.signedAddresses, address];
    const updatedRejectedAddresses = [...transaction.rejectedAddresses];

    const totalSigners = wallet.signersAddresses.length;
    const requiredSigners = wallet.numRequiredSigners ?? undefined;

    let thresholdReached = false;
    switch (wallet.type) {
      case "any":
        thresholdReached = true;
        break;
      case "all":
        thresholdReached = updatedSignedAddresses.length >= totalSigners;
        break;
      case "atLeast":
        thresholdReached =
          typeof requiredSigners === "number" &&
          updatedSignedAddresses.length >= requiredSigners;
        break;
      default:
        thresholdReached = false;
    }

    let finalTxHash: string | undefined;
    if (thresholdReached && !finalTxHash) {
      try {
        const network = resolveNetworkFromAddress(address);
        const blockchainProvider = getProvider(network);
        finalTxHash = await blockchainProvider.submitTx(signedTx);
      } catch (submitError) {
        console.error("Failed to submit transaction", {
          message: (submitError as Error)?.message,
          stack: (submitError as Error)?.stack,
        });
        return res.status(502).json({ error: "Failed to submit transaction" });
      }
    }

    const nextState = finalTxHash ? 1 : 0;

    const updatedTransaction = await caller.transaction.updateTransaction({
      transactionId,
      txCbor: signedTx,
      signedAddresses: updatedSignedAddresses,
      rejectedAddresses: updatedRejectedAddresses,
      state: nextState,
      txHash: finalTxHash,
    });

    return res.status(200).json({
      transaction: updatedTransaction,
      thresholdReached,
    });
  } catch (error) {
    console.error("Error in signTransaction handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

