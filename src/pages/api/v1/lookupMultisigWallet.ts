import type { NextApiRequest, NextApiResponse } from "next";
import { getProvider } from "@/utils/get-provider";

/**
 * @swagger
 * /api/v1/lookupMultisigWallet:
 *   get:
 *     tags: [V1]
 *     summary: Lookup multisig wallet metadata using pubKeyHashes
 *     parameters:
 *       - name: pubKeyHashes
 *         in: query
 *         required: true
 *         description: |
 *          Single Key Hashes or
 *          Comma-separated list of public key hashes
 *         schema:
 *           type: string
 *       - name: network
 *         in: query
 *         required: false
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: A list of matching metadata items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { pubKeyHashes, network = "1" } = req.query;

  if (typeof pubKeyHashes !== "string") {
    return res.status(400).json({ error: "Missing or invalid pubKeyHashes parameter" });
  }

  const hashes = pubKeyHashes.split(",").map((s) => s.trim().toLowerCase());
  const networkId = parseInt(network as string, 10);

  const provider = getProvider(networkId);

  try {
    const response = await provider.get('/metadata/txs/labels/1854');

    if (!Array.isArray(response)) {
      throw new Error("Invalid response format from provider");
    }

    const validItems = response.filter((item: any) => {
      const participants = item.json_metadata?.participants;
      return participants && Object.keys(participants).length > 0;
    });

    const matchedItems = validItems.filter((item: any) => {
      const participants = item.json_metadata.participants;
      return Object.keys(participants).some((hash: string) =>
        hashes.includes(hash.toLowerCase())
      );
    });

    res.status(200).json(matchedItems);
  } catch (error) {
    console.error("lookupWallet error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}