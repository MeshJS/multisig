import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { getProvider } from "@/utils/get-provider";

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
  };

  const {
    walletId,
    address,
    txCbor,
    txJson,
    description = "External Tx",
    callbackUrl,
  } = req.body;

  if (!walletId) {
    return res.status(400).json({ error: "Missing required field walletId!" });
  }
  if (!address) {
    return res.status(400).json({ error: "Missing required field address!" });
  }
  // Optionally check that the address matches the session user.id for security
  if (session.user.id !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }
  if (!txCbor) {
    return res.status(400).json({ error: "Missing required field txCbor!" });
  }
  if (!txJson) {
    return res.status(400).json({ error: "Missing required field txJson!" });
  }
  const wallet = await db.wallet.findUnique({ where: { id: walletId } });
  const reqSigners = wallet?.numRequiredSigners;
  const type = wallet?.type;
  const network = address.includes("test") ? 0 : 1;

  try {
    let newTx;
    //ToDo refactor to more cases.
    if (reqSigners === 1 || type === "any") {
      const blockchainProvider = getProvider(network);
      newTx = blockchainProvider.submitTx(txCbor);
    } else {
      newTx = await db.transaction.create({
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
    }

    res.status(201).json(newTx);
  } catch (error) {
    console.error("Error creating transaction:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
