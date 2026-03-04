import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { BOT_SCOPES, type BotScope } from "@/lib/auth/botKey";
import { ClaimError, performClaim } from "@/lib/auth/claimBot";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/botClaim" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!enforceBodySize(req, res, 2 * 1024)) {
    return;
  }

  // --- Verify human JWT ---

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthorized", message: "Missing or invalid Authorization header" });
  }

  const jwt = verifyJwt(authHeader.slice(7));
  if (!jwt) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
  }

  if (isBotJwt(jwt)) {
    return res.status(401).json({ error: "unauthorized", message: "Bot tokens cannot claim bots" });
  }

  const ownerAddress = jwt.address;

  // --- Validate input ---

  const { pendingBotId, claimCode, approvedScopes } = req.body;

  if (typeof pendingBotId !== "string" || pendingBotId.length < 1) {
    return res.status(400).json({ error: "invalid_claim_payload", message: "pendingBotId is required" });
  }

  if (typeof claimCode !== "string" || claimCode.length < 24) {
    return res.status(400).json({ error: "invalid_claim_payload", message: "claimCode must be at least 24 characters" });
  }

  // Validate approvedScopes if provided
  let finalScopes: BotScope[] | null = null;
  if (approvedScopes !== undefined && approvedScopes !== null) {
    if (!Array.isArray(approvedScopes)) {
      return res.status(400).json({ error: "invalid_claim_payload", message: "approvedScopes must be an array" });
    }
    const valid = approvedScopes.filter(
      (s): s is BotScope => typeof s === "string" && (BOT_SCOPES as readonly string[]).includes(s),
    );
    if (valid.length !== approvedScopes.length) {
      return res.status(400).json({ error: "invalid_claim_payload", message: "approvedScopes contains invalid scope values" });
    }
    finalScopes = valid;
  }

  // --- Perform claim ---

  try {
    const result = await db.$transaction(async (tx) => {
      return performClaim(tx, {
        pendingBotId,
        claimCode,
        approvedScopes: finalScopes,
        ownerAddress,
      });
    });

    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof ClaimError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    console.error("botClaim error:", err);
    return res.status(500).json({ error: "internal_error", message: "An unexpected error occurred" });
  }
}
