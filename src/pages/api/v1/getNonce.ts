import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";

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

  if (req.method === "GET") {
    try {
      const { address } = req.query;
      if (typeof address !== "string") {
        return res.status(400).json({ error: "Invalid address" });
      }
      
      // Verify that the address exists in the User table
      const user = await db.user.findUnique({ where: { address } });
      if (!user) {
        return res.status(404).json({ error: "Address not found" });
      }

      // Check if a nonce already exists for this address in the database
      const existing = await db.nonce.findFirst({ where: { address } });
      if (existing) {
        return res.status(200).json({ nonce: existing.value });
      }

      const nonce = randomBytes(16).toString("hex");
      await db.nonce.create({
        data: {
          address,
          value: nonce,
        },
      });
      return res.status(200).json({ nonce });
    } catch (error) {
      console.error("Error in getNonce:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }

  res.status(405).end();
}
