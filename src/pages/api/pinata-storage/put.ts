import type { NextApiRequest, NextApiResponse } from "next";

import { getWalletSessionFromReq } from "@/lib/auth/walletSession";
import { verifyJwt } from "@/lib/verifyJwt";
import { applyRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { pinJsonLd, PinataUploadError, MAX_PIN_BYTES } from "@/lib/server/pinataUpload";

/**
 * POST /api/pinata-storage/put — pin a JSON-LD document to IPFS.
 *
 * Authentication is required. This endpoint was previously open to the
 * internet: anyone could pin arbitrary content to the project's Pinata account
 * and burn its quota, with no record of who did it. It now requires either the
 * app's wallet session (the in-app DRep metadata flows, which are same-origin
 * and send the cookie) or a v1 bearer token.
 *
 * It is deliberately a low-level primitive with no notion of what it is
 * pinning. Ballot rationales go through POST /api/v1/ballotRationaleAnchor
 * instead, which authorizes against the wallet and records the resulting
 * anchor.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!applyRateLimit(req, res, { keySuffix: "pinata/put", maxRequests: 20 })) {
    return;
  }
  if (!enforceBodySize(req, res, MAX_PIN_BYTES)) {
    return;
  }

  const session = getWalletSessionFromReq(req);
  const hasWalletSession = (session?.wallets?.length ?? 0) > 0;
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const hasBearer = bearer ? verifyJwt(bearer) !== null : false;

  if (!hasWalletSession && !hasBearer) {
    return res
      .status(401)
      .json({ error: "Unauthorized - connect and authorize a wallet first" });
  }

  const pathname = typeof req.body?.pathname === "string" ? req.body.pathname : "";
  const value = typeof req.body?.value === "string" ? req.body.value : "";
  if (!pathname || !value) {
    return res.status(400).json({ error: "pathname and value are required" });
  }

  try {
    const pinned = await pinJsonLd(pathname, value);
    return res.status(200).json(pinned);
  } catch (error) {
    if (error instanceof PinataUploadError) {
      return res
        .status(error.status)
        .json({ error: error.message, details: error.details });
    }
    console.error("Error uploading to Pinata:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
