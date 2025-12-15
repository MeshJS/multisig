import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { sign } from "jsonwebtoken";
import {
  checkSignature,
  DataSignature,
} from "@meshsdk/core";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, enforceBodySize } from "@/lib/security/requestGuards";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);
  
  if (!applyRateLimit(req, res, { keySuffix: "v1/authSigner" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "POST") {
    if (!enforceBodySize(req, res, 64 * 1024)) {
      return;
    }
    const { address, signature, key } = req.body;
    if (
      typeof address !== "string" ||
      typeof signature !== "string" ||
      typeof key !== "string"
    ) {
      return res
        .status(400)
        .json({ error: "Missing address, signature or key." });
    }

    // Fetch the nonce from the database
    const nonceEntry = await db.nonce.findFirst({ where: { address } });
    if (!nonceEntry) {
      return res
        .status(400)
        .json({ error: "No nonce issued for this address" });
    }

    const nonce = nonceEntry.value;
    const sig: DataSignature = { signature: signature, key: key };

    const isValid = await checkSignature(nonce, sig, address);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Delete the nonce from the database after verification
    await db.nonce.delete({ where: { id: nonceEntry.id } });

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not defined in environment variables");
    }
    const token = sign({ address }, jwtSecret, { expiresIn: "1h" });

    return res.status(200).json({ token });
  }

  res.status(405).end();
}
