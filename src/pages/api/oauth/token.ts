import type { NextApiRequest, NextApiResponse } from "next";

import { db } from "@/server/db";
import { isMcpScope, type McpScope } from "@/lib/mcp/scopes";
import { hashSecret, resolveClient } from "@/lib/oauth/clients";
import { issuerOrigin, resourceUrl } from "@/lib/oauth/config";
import { verifyCodeChallenge } from "@/lib/oauth/pkce";
import { hashToken, mintAccessToken } from "@/lib/oauth/accessToken";
import {
  issueRefreshToken,
  markRefreshTokenRotated,
  redeemRefreshToken,
} from "@/lib/oauth/tokens";
import { applyRateLimit, enforceBodySize } from "@/lib/security/requestGuards";

/**
 * POST /api/oauth/token — OAuth 2.1 token endpoint.
 *
 * Grants: `authorization_code` (with PKCE) and `refresh_token` (rotating).
 * Bodies arrive form-encoded, which Next's body parser handles natively.
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    return await issueToken(req, res);
  } catch (error) {
    console.error("[api/oauth/token] failed:", error);
    if (!res.headersSent) {
      return fail(res, 500, "server_error", "Token issuance is temporarily unavailable");
    }
    return undefined;
  }
}

async function issueToken(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "invalid_request" });
  }
  if (!applyRateLimit(req, res, { keySuffix: "oauth/token", maxRequests: 60 })) {
    return;
  }
  if (!enforceBodySize(req, res, 8 * 1024)) {
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const grantType = str(body.grant_type);
  const clientId = str(body.client_id);

  if (!clientId) {
    return fail(res, 400, "invalid_client", "client_id is required");
  }

  const client = await resolveClient(clientId);
  if (!client) {
    return fail(res, 401, "invalid_client", "Unknown client");
  }

  // Confidential clients must authenticate. Public clients ("none") rely on
  // PKCE instead, which is the MCP norm.
  if (client.tokenEndpointAuthMethod !== "none") {
    const presented = str(body.client_secret);
    if (
      !presented ||
      !client.secretHash ||
      hashSecret(presented) !== client.secretHash
    ) {
      return fail(res, 401, "invalid_client", "Client authentication failed");
    }
  }

  if (grantType === "authorization_code") {
    return handleAuthorizationCode(req, res, client.clientId, body);
  }
  if (grantType === "refresh_token") {
    return handleRefresh(req, res, client.clientId, body);
  }
  return fail(res, 400, "unsupported_grant_type", "Supported: authorization_code, refresh_token");
}

async function handleAuthorizationCode(
  req: NextApiRequest,
  res: NextApiResponse,
  clientId: string,
  body: Record<string, unknown>,
) {
  const code = str(body.code);
  const verifier = str(body.code_verifier);
  const redirectUri = str(body.redirect_uri);

  if (!code || !verifier) {
    return fail(res, 400, "invalid_request", "code and code_verifier are required");
  }

  const record = await db.oAuthAuthorizationCode.findUnique({
    where: { codeHash: hashToken(code) },
  });
  if (!record || record.clientId !== clientId) {
    return fail(res, 400, "invalid_grant", "Unknown authorization code");
  }

  if (record.consumedAt) {
    // Replay. The code already bought a token, so treat the whole grant as
    // compromised and revoke every refresh token issued under it.
    await db.oAuthRefreshToken.updateMany({
      where: {
        clientId: record.clientId,
        subjectAddress: record.subjectAddress,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return fail(res, 400, "invalid_grant", "Authorization code has already been used");
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return fail(res, 400, "invalid_grant", "Authorization code has expired");
  }
  if (redirectUri && redirectUri !== record.redirectUri) {
    return fail(res, 400, "invalid_grant", "redirect_uri does not match the authorization request");
  }
  if (!verifyCodeChallenge(verifier, record.codeChallenge)) {
    return fail(res, 400, "invalid_grant", "PKCE verification failed");
  }

  // Consume before issuing, and only if still unconsumed, so two concurrent
  // redemptions of the same code cannot both succeed.
  const consumed = await db.oAuthAuthorizationCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) {
    return fail(res, 400, "invalid_grant", "Authorization code has already been used");
  }

  const scopes = record.scopes.filter(isMcpScope);

  return issueTokens(req, res, {
    clientId,
    subject: record.subjectAddress,
    addresses: record.grantedAddresses,
    scopes,
    resource: record.resource,
  });
}

async function handleRefresh(
  req: NextApiRequest,
  res: NextApiResponse,
  clientId: string,
  body: Record<string, unknown>,
) {
  const presented = str(body.refresh_token);
  if (!presented) {
    return fail(res, 400, "invalid_request", "refresh_token is required");
  }

  const redemption = await redeemRefreshToken(presented, clientId);
  if (!redemption.ok) {
    return fail(res, 400, "invalid_grant", `Refresh token ${redemption.reason}`);
  }

  const record = redemption.record;

  // A refresh may narrow scope but never widen it (OAuth 2.1 §4.3.2).
  const requested = str(body.scope);
  const granted = record.scopes.filter(isMcpScope);
  const scopes = requested
    ? granted.filter((s) => requested.split(/\s+/).includes(s))
    : granted;

  // Refuse rather than mint a zero-scope token. An empty scope set produces a
  // token that verifies fine but registers no tools, so every MCP call would
  // come back "method not found" — an opaque failure the client cannot diagnose.
  // `invalid_scope` says what actually went wrong.
  if (scopes.length === 0) {
    return fail(
      res,
      400,
      "invalid_scope",
      "The requested scope is empty or outside this grant",
    );
  }

  const result = await issueTokens(req, res, {
    clientId,
    subject: record.subjectAddress,
    addresses: record.grantedAddresses,
    scopes,
    resource: record.resource,
    rotateFrom: record.tokenHash,
  });
  return result;
}

async function issueTokens(
  req: NextApiRequest,
  res: NextApiResponse,
  args: {
    clientId: string;
    subject: string;
    addresses: string[];
    scopes: McpScope[];
    resource: string;
    rotateFrom?: string;
  },
) {
  const { token: accessToken, expiresIn } = mintAccessToken({
    issuer: issuerOrigin(req),
    resource: args.resource || resourceUrl(req),
    subject: args.subject,
    clientId: args.clientId,
    scopes: args.scopes,
    addresses: args.addresses,
  });

  const refreshToken = await issueRefreshToken({
    clientId: args.clientId,
    subjectAddress: args.subject,
    grantedAddresses: args.addresses,
    scopes: args.scopes,
    resource: args.resource,
  });

  if (args.rotateFrom) {
    await markRefreshTokenRotated(args.rotateFrom, refreshToken);
  }

  return res.status(200).json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: refreshToken,
    scope: args.scopes.join(" "),
  });
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fail(
  res: NextApiResponse,
  status: number,
  error: string,
  description: string,
) {
  return res.status(status).json({ error, error_description: description });
}
