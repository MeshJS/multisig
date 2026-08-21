import type { NextApiRequest, NextApiResponse } from "next";

import { protectedResourceMetadata } from "@/lib/oauth/config";
import { applyRateLimit } from "@/lib/security/requestGuards";

/**
 * RFC 9728 Protected Resource Metadata — the document the MCP endpoint's 401
 * challenge points at, telling a client which authorization server to use.
 *
 * Served for both the path-aware form
 * (`/.well-known/oauth-protected-resource/api/mcp`) and the bare root form, via
 * rewrites in next.config.js. Clients probe path-first, then root, so both must
 * answer.
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
  if (!applyRateLimit(req, res, { keySuffix: "oauth/prm", maxRequests: 120 })) {
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.status(200).json(protectedResourceMetadata(req));
}
