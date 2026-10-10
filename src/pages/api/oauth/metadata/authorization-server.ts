import type { NextApiRequest, NextApiResponse } from "next";

import { authorizationServerMetadata } from "@/lib/oauth/config";
import { applyRateLimit } from "@/lib/security/requestGuards";

/**
 * RFC 8414 Authorization Server Metadata.
 *
 * Served at `/.well-known/oauth-authorization-server` via a rewrite in
 * next.config.js — Next ignores dot-directories under `pages/`, so the
 * well-known path cannot be a file.
 *
 * Deliberately public and CORS-open: discovery documents carry no secrets, and
 * browser-based clients must be able to read them before they hold any token.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!applyRateLimit(req, res, { keySuffix: "oauth/as-metadata", maxRequests: 120 })) {
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.status(200).json(authorizationServerMetadata(req));
}
