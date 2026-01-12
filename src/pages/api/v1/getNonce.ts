import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit } from "@/lib/security/requestGuards";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);
  
  if (!applyRateLimit(req, res, { keySuffix: "v1/getNonce" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    try {
      const { address } = req.query;
      if (typeof address !== "string") {
        console.error("[getNonce] Invalid address param:", address);
        return res.status(400).json({ error: "Invalid address" });
      }

      // Log whether the address has a corresponding user, but don't block nonce issuance.
      // This allows first-time wallet connections to authorize via nonce signing.
      const user = await db.user.findUnique({ where: { address } });
      if (!user) {
        console.warn("[getNonce] Address has no User record yet:", address);
      } else {
        console.debug("[getNonce] Found User for address:", {
          address,
          userId: user.id,
        });
      }

      // Check if a nonce already exists for this address in the database
      const existing = await db.nonce.findFirst({ where: { address } });
      if (existing) {
        console.debug("[getNonce] Reusing existing nonce for address:", address);
        return res.status(200).json({ nonce: existing.value });
      }

      const nonce = randomBytes(16).toString("hex");
      await db.nonce.create({
        data: {
          address,
          value: nonce,
        },
      });
      console.debug("[getNonce] Created new nonce for address:", address);
      return res.status(200).json({ nonce });
    } catch (error) {
      console.error("[getNonce] Error:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }

  res.status(405).end();
}
