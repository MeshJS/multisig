import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
//get all utxos for wallet
//get all pending txs for the wallet
//remove all wallet input utxos found in pending txs from the whole pool of txs.
import type { Wallet as DbWallet } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { buildMultisigWallet } from "@/utils/common";
import { getProvider } from "@/utils/get-provider";
import { addressToNetwork } from "@/utils/multisigSDK";
import type { UTxO } from "@meshsdk/core";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { verifyJwt } from "@/lib/verifyJwt";
import { DbWalletWithLegacy } from "@/types/wallet";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);
  
  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "GET") {
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

  // You can now use payload.address for scope checks or logging
  const session = {
    user: { id: payload.address },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
  };
  const caller = createCaller({ db, session });

  const { walletId, address } = req.query;

  if (typeof address !== "string") {
    return res.status(400).json({ error: "Invalid address parameter" });
  }
  if (payload.address !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }
  if (typeof walletId !== "string") {
    return res.status(400).json({ error: "Invalid walletId parameter" });
  }

  try {
    const pendingTxsResult = await caller.transaction.getPendingTransactions({
      walletId,
    });
    if (!pendingTxsResult) {
      return res
        .status(500)
        .json({ error: "Wallet could not fetch pending Txs" });
    }

    const walletFetch: DbWallet | null = await caller.wallet.getWallet({
      walletId,
      address,
    });
    if (!walletFetch) {
      return res.status(404).json({ error: "Wallet not found" });
    }
    const mWallet = buildMultisigWallet(walletFetch as DbWalletWithLegacy);
    if (!mWallet) {
      return res.status(500).json({ error: "Wallet could not be constructed" });
    }
    const addr = mWallet.getScript().address;
    const network = addressToNetwork(addr);

    const blockchainProvider = getProvider(network);

    const utxos: UTxO[] = await blockchainProvider.fetchAddressUTxOs(addr);

    const blockedUtxos: { hash: string; index: number }[] =
      pendingTxsResult.flatMap((m): { hash: string; index: number }[] => {
        try {
          const txJson: {
            inputs: { txIn: { txHash: string; txIndex: number } }[];
          } = JSON.parse(m.txJson);
          return txJson.inputs.map((n) => ({
            hash: n.txIn.txHash,
            index: n.txIn.txIndex,
          }));
        } catch (e) {
          console.error("Failed to parse txJson:", m.txJson, e);
          return [];
        }
      });

    const freeUtxos = utxos.filter(
      (utxo) =>
        !blockedUtxos.some(
          (bU) =>
            bU.hash === utxo.input.txHash &&
            bU.index === utxo.input.outputIndex,
        ),
    );

    res.status(200).json(freeUtxos);
  } catch (error) {
    console.error("Error in freeUtxos handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    res.status(500).json({ error: "Internal Server Error" });
  }
}
