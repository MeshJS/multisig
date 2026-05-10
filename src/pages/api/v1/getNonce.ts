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
      try {
        const user = await db.user.findUnique({ where: { address } });
        if (!user) {
          console.warn("[getNonce] Address has no User record yet:", address);
        } else {
          console.debug("[getNonce] Found User for address:", {
            address,
            userId: user.id,
          });
        }
      } catch (userLookupError) {
        console.warn("[getNonce] User lookup failed (table may not exist yet):", (userLookupError as Error).message);
      }

      // Always rotate the nonce on issue. Reusing a stored nonce is a
      // replay risk: a leaked sig-with-old-nonce stays valid until that row
      // is consumed. Mint a fresh value every call.
      const nonce = randomBytes(16).toString("hex");
      const existing = await db.nonce.findFirst({ where: { address } });
      if (existing) {
        await db.nonce.update({
          where: { id: existing.id },
          data: { value: nonce },
        });
      } else {
        await db.nonce.create({
          data: { address, value: nonce },
        });
      }
      return res.status(200).json({ nonce });
    } catch (error) {
      console.error("[getNonce] Error:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }

  res.status(405).end();
}
