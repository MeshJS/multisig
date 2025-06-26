import type { NextApiRequest, NextApiResponse } from "next";
import { getProvider } from "@/utils/get-provider";
import { cors } from "@/lib/cors";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { pubKeyHashes, network = "1" } = req.query;

  if (typeof pubKeyHashes !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid pubKeyHashes parameter" });
  }

  const hashes = pubKeyHashes.split(",").map((s) => s.trim().toLowerCase());
  console.log(hashes);
  const networkId = parseInt(network as string, 10);

  const provider = getProvider(networkId);

  try {
    const response = await provider.get("/metadata/txs/labels/1854");

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
        hashes.includes(hash.toLowerCase()),
      );
    });

    res.status(200).json(matchedItems);
  } catch (error) {
    console.error("lookupWallet error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
