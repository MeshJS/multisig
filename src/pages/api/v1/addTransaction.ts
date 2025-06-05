import type { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = await getServerAuthSession({ req, res });
//   if (!session || !session.user) {
//     return res.status(401).json({ error: "Unauthorized." });
//   }


//JSON.stringify(txBuilder.meshTxBuilderBody),


  const { walletId, address, txCbor, txJson, description="External Tx" } = req.body;

  console.log( walletId)

  if (!walletId ) {
    return res.status(400).json({ error: "Missing required field walletId!" });
  }
  if (!address ) {
    return res.status(400).json({ error: "Missing required field address!" });
  }
  if (!txCbor ) {
    return res.status(400).json({ error: "Missing required field txCbor!" });
  }
  if (!txJson ) {
    return res.status(400).json({ error: "Missing required field txJson!" });
  }


  try {
    const newTx = await db.transaction.create({
      data: {
        walletId,
        txJson: typeof txJson === "object" ? JSON.stringify(txJson) : txJson,
        txCbor,
        signedAddresses: [address],
        rejectedAddresses: [],
        description,
        state: 0,
      },
    });

    res.status(201).json(newTx);
  } catch (error) {
    console.error("Error creating transaction:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}