import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

import { db } from "@/server/db";
import { hashSecret } from "@/lib/oauth/clients";
import { isAcceptableRedirectUri, MAX_REDIRECT_URIS } from "@/lib/oauth/redirects";
import { generateOpaqueToken } from "@/lib/oauth/accessToken";
import { applyStrictRateLimit, enforceBodySize } from "@/lib/security/requestGuards";

/**
 * POST /api/oauth/register — RFC 7591 Dynamic Client Registration.
 *
 * Deprecated by the 2026-07-28 MCP revision in favour of Client ID Metadata
 * Documents, and kept only as the documented fallback: a client that cannot do
 * CIMD has no other way to obtain a client_id, and Claude Code falls back here
 * when either `client_id_metadata_document_supported` or `"none"` auth is
 * missing from our metadata. Prefer CIMD — DCR mints a fresh client row on every
 * fresh connection.
 *
 * Open registration is what the spec expects, so this is rate-limited hard
 * rather than authenticated.
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    return await register(req, res);
  } catch (error) {
    console.error("[api/oauth/register] failed:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: "server_error",
        error_description: "Registration is temporarily unavailable",
      });
    }
    return undefined;
  }
}

async function register(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "invalid_request" });
  }
  if (!applyStrictRateLimit(req, res, { keySuffix: "oauth/register", maxRequests: 10 })) {
    return;
  }
  if (!enforceBodySize(req, res, 8 * 1024)) {
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS) {
    return res.status(400).json({
      error: "invalid_redirect_uri",
      error_description: `redirect_uris must contain 1-${MAX_REDIRECT_URIS} entries`,
    });
  }

  for (const uri of redirectUris) {
    if (!isAcceptableRedirectUri(uri)) {
      return res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: `redirect_uri must be https, or http on a loopback host: ${uri}`,
      });
    }
  }

  const clientName =
    typeof body.client_name === "string" && body.client_name.length > 0
      ? body.client_name.slice(0, 200)
      : "Unnamed MCP client";

  // Public clients are the norm here (native apps and CLIs cannot keep a
  // secret); they are protected by PKCE instead.
  const requestedAuth =
    typeof body.token_endpoint_auth_method === "string"
      ? body.token_endpoint_auth_method
      : "none";
  const isPublic = requestedAuth === "none";
  const secret = isPublic ? null : generateOpaqueToken();

  const clientId = `mcp-${randomUUID()}`;
  const client = await db.oAuthClient.create({
    data: {
      clientId,
      clientName,
      clientUri: typeof body.client_uri === "string" ? body.client_uri : null,
      redirectUris,
      tokenEndpointAuthMethod: isPublic ? "none" : "client_secret_post",
      secretHash: secret ? hashSecret(secret) : null,
      isMetadataUrl: false,
    },
  });

  return res.status(201).json({
    client_id: client.clientId,
    ...(secret ? { client_secret: secret } : {}),
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
}
