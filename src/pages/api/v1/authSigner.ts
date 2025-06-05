

import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";

// In-memory nonce store. Replace with persistent store in production.
const nonceStore: Record<string, string> = {};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    const { address } = req.query;
    if (typeof address !== "string") {
      return res.status(400).json({ error: "Invalid address" });
    }
    const nonce = randomBytes(16).toString("hex");
    nonceStore[address] = nonce;
    return res.status(200).json({ nonce });
  }

  if (req.method === "POST") {
    const { address, signature } = req.body;
    if (typeof address !== "string" || typeof signature !== "string") {
      return res.status(400).json({ error: "Missing address or signature" });
    }
    const nonce = nonceStore[address];
    if (!nonce) {
      return res.status(400).json({ error: "No nonce issued for this address" });
    }

    //Get Keyhash from Address 

    //check for correct signature


    // Dummy signature check. Replace with actual cryptographic verification.
    const isValid = signature === `signed(${nonce})`;

    if (!isValid) {
      return res.status(401).json({ error: "Invalid signature" });
    }
    delete nonceStore[address];

    // Return mock bearer token. Replace with JWT/session token in production.

    // Add JWT Scope -Address (walletID)
    return res.status(200).json({ token: `Bearer dummy-token-for-${address}` });
  }

  res.status(405).end();
}