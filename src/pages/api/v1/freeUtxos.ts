//get all utxos for wallet
//get all pending txs for the wallet
//remove all wallet input utxos found in pending txs from the whole pool of txs.
import type { Wallet as DbWallet } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { apiServer } from "@/utils/apiServer";
import { buildMultisigWallet } from "@/utils/common";
import { getProvider } from "@/utils/get-provider";
import { addressToNetwork } from "@/utils/multisigSDK";
import type { UTxO } from "@meshsdk/core";

/**
 * @swagger
 * tags:
 *   - name: V1
 *     description: |
 *      This is an alaha Version.
 *      Click to open or close.
 * /api/v1/freeUtxos:
 *   get:
 *     tags: [V1]
 *     summary: Get unblocked UTxOs for a wallet
 *     parameters:
 *       - name: walletId
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: address
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: A list of free UTxOs
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   input:
 *                     type: object
 *                     properties:
 *                       txHash:
 *                         type: string
 *                       outputIndex:
 *                         type: number
 *                   output:
 *                     type: object
 *                     properties:
 *                       address:
 *                         type: string
 *                       amount:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             unit:
 *                               type: string
 *                             quantity:
 *                               type: string
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { walletId, address } = req.query;

  if (typeof address !== "string") {
    return res.status(400).json({ error: "Invalid address parameter" });
  }
  if (typeof walletId !== "string") {
    return res.status(400).json({ error: "Invalid walletId parameter" });
  }

  try {
    const pendingTxsResult = await apiServer.transaction.getPendingTransactions.query({
      walletId,
    });

    if (!pendingTxsResult) {
      return res
        .status(500)
        .json({ error: "Wallet could not fetch pending Txs" });
    }

    const walletFetch: DbWallet | null = await apiServer.wallet.getWallet.query(
      { walletId, address },
    );
    if (!walletFetch) {
      return res.status(404).json({ error: "Wallet not found" });
    }
    const mWallet = buildMultisigWallet(walletFetch);
    if (!mWallet) {
      return res.status(500).json({ error: "Wallet could not be constructed" });
    }
    const addr = mWallet.getScript().address;
    const network = addressToNetwork(addr);

    const blockchainProvider = getProvider(network);

    const utxos: UTxO[] = await blockchainProvider.fetchAddressUTxOs(addr);

    const blockedUtxos: { hash: string; index: number }[] = (
      pendingTxsResult
    ).flatMap((m): { hash: string; index: number }[] => {
      const txJson: {
        inputs: { txIn: { txHash: string; txIndex: number } }[];
      } = JSON.parse(m.txJson);
      return txJson.inputs.map((n) => ({
        hash: n.txIn.txHash,
        index: n.txIn.txIndex,
      }));
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
    console.error("Error fetching wallet IDs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
