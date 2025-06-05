import { NextApiRequest, NextApiResponse } from "next";
import { Wallet as DbWallet } from "@prisma/client";
import { buildMultisigWallet } from "@/utils/common";
import { getServerAuthSession } from "@/server/auth";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";

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
    const session = await getServerAuthSession({ req, res });
    // if (!session || !session.user) {
    //   return res.status(401).json({ error: "Unauthorized" });
    // }
    const caller = createCaller({ db, session });
    const walletFetch: DbWallet | null = await caller.wallet.getWallet({ walletId, address });
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
