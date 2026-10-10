import type { NextApiRequest, NextApiResponse } from "next";

import { summariseDocument } from "@/lib/documents/summary";
import { addCorsCacheBustingHeaders, cors } from "@/lib/cors";
import { getClientIP } from "@/lib/security/rateLimit";
import {
  applyBotRateLimit,
  applyRateLimit,
} from "@/lib/security/requestGuards";
import { isBotJwt, verifyJwt } from "@/lib/verifyJwt";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";

/**
 * GET /api/v1/documentDetail?documentId=&address= — one document with its
 * version history and audit events.
 *
 * Same rules as `documents.ts`: authorization goes through
 * `caller.document.getById` rather than being re-implemented, the response is a
 * projection, and bot keys are excluded.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/documentDetail" })) return;

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

  if (isBotJwt(payload) && !applyBotRateLimit(req, res, payload.botId)) return;

  const { documentId, address } = req.query;
  if (typeof address !== "string") {
    return res.status(400).json({ error: "Invalid address parameter" });
  }
  if (payload.address !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }
  if (typeof documentId !== "string") {
    return res.status(400).json({ error: "Invalid documentId parameter" });
  }

  if (isBotJwt(payload)) {
    // See documents.ts: sign-off is a human accountability record.
    return res
      .status(403)
      .json({ error: "Document sign-off is not available to bot keys" });
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

    const document = await caller.document.getById({ documentId });
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    return res.status(200).json({
      ...summariseDocument(document),
      events: (document.events ?? []).map((event) => ({
        type: event.type,
        actorAddress: event.actorAddress,
        createdAt: new Date(event.createdAt).toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error in documentDetail handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
