import { NextApiRequest, NextApiResponse } from "next";
import { apiServer } from "@/utils/apiServer";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { address } = req.query;

  if (typeof address !== "string") {
    return res.status(400).json({ error: "Invalid address parameter" });
  }

  try {
    const wallets = await apiServer.wallet.getUserWallets.query({ address });
    if (!wallets) {
      return res.status(404).json({ error: "Wallets not found" });
    }
    const walletIds = wallets.map((w) => ({
      walletId: w.id,
      walletName: w.name,
    }));

    if (walletIds.length === 0) {
      return res.status(404).json({ error: "Wallets not found" });
    }

    res.status(200).json(walletIds);
  } catch (error) {
    console.error("Error fetching wallet IDs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
