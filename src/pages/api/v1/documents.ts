import type { NextApiRequest, NextApiResponse } from "next";

import { addCorsCacheBustingHeaders, cors } from "@/lib/cors";
import { getClientIP } from "@/lib/security/rateLimit";
import {
  applyBotRateLimit,
  applyRateLimit,
} from "@/lib/security/requestGuards";
import { isBotJwt, verifyJwt } from "@/lib/verifyJwt";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { summariseDocument } from "@/lib/documents/summary";

/**
 * GET /api/v1/documents?walletId=&address= — sign-off documents for a wallet.
 *
 * Authorization is not re-implemented here: the request goes through
 * `caller.document.listByWallet`, so the same signer-or-owner rule the UI uses
 * applies, and there is one place to change it.
 *
 * The response is a deliberate PROJECTION, not the raw rows — see
 * `summariseDocument`. This endpoint backs an MCP tool, so its output reaches a
 * model, and the raw rows carry up to 512KB of inline base64 per version.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/documents" })) return;

  await cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({
      error:
        "Unauthorized - Missing or malformed Authorization header (expected: Bearer <token>)",
    });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  if (isBotJwt(payload)) {
    if (!applyBotRateLimit(req, res, payload.botId)) return;
    // Bot keys are deliberately excluded. Sign-off is a human accountability
    // record: every approval is a CIP-8 signature from a named wallet signer,
    // and an automated identity has no standing in it. Reading alone is
    // harmless, but it is the first step of a surface that only makes sense for
    // people, so it waits for a reason to exist.
    return res
      .status(403)
      .json({ error: "Document sign-off is not available to bot keys" });
  }

  const { walletId, address, includeArchived } = req.query;
  if (typeof address !== "string") {
    return res.status(400).json({ error: "Invalid address parameter" });
  }
  if (payload.address !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }
  if (typeof walletId !== "string") {
    return res.status(400).json({ error: "Invalid walletId parameter" });
  }

  try {
    const caller = createCaller({
      db,
      session: {
        user: { id: payload.address },
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      sessionAddress: payload.address,
      sessionWallets: [payload.address],
      primaryWallet: payload.address,
      ip: getClientIP(req),
    });

    const documents = await caller.document.listByWallet({
      walletId,
      includeArchived: includeArchived === "true",
    });

    return res.status(200).json(documents.map(summariseDocument));
  } catch (error) {
    console.error("Error in documents handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
