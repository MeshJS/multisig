/**
 * @swagger
 * /api/v1/nativeScript:
 *   get:
 *     tags: [V1]
 *     summary: Get native scripts for a multisig wallet
 *     description: Returns native scripts generated from the specified walletId and address.
 *     parameters:
 *       - in: query
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the multisig wallet
 *       - in: query
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Address associated with the wallet
 *     responses:
 *       200:
 *         description: An array of native scripts
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       400:
 *         description: Invalid address or walletId parameter
 *       404:
 *         description: Wallet not found
 *       500:
 *         description: Internal server error
 */
import { NextApiRequest, NextApiResponse } from "next";
import { Wallet as DbWallet } from "@prisma/client";
import { buildMultisigWallet } from "@/utils/common";
import { apiServer } from "@/utils/apiServer";

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
    const types = mWallet.getAvailableTypes();
    if (!types) {
      return res.status(500).json({ error: "Wallet could not be constructed" });
    }

    return res.status(200).json(
      types.map((m) => ({
        type: m,
        script: mWallet.buildScript(m),
      })),
    );
  } catch (error) {
    console.error("Error fetching wallet IDs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
