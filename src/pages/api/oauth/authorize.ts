import type { NextApiRequest, NextApiResponse } from "next";

import { resolveClient } from "@/lib/oauth/clients";
import {
  findMatchingRedirectUri,
  isAcceptableRedirectUri,
} from "@/lib/oauth/redirects";
import { issuerOrigin, resourceUrl } from "@/lib/oauth/config";
import { isValidCodeChallenge } from "@/lib/oauth/pkce";
import { encodeAuthorizationRequest } from "@/lib/oauth/requests";
import { MCP_SCOPES, isMcpScope, type McpScope } from "@/lib/mcp/scopes";
import { applyRateLimit } from "@/lib/security/requestGuards";

/**
 * GET /api/oauth/authorize — OAuth 2.1 authorization endpoint.
 *
 * Validates the request, then hands off to the consent page with a signed
 * description of it. No code is issued here; that happens only after the user
 * approves at `/api/oauth/decision`.
 */

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    return await authorize(req, res);
  } catch (error) {
    // A database or CIMD-fetch failure must not escape as an unhandled
    // rejection. Answer with an OAuth error rather than a bare stack.
    console.error("[api/oauth/authorize] failed:", error);
    if (!res.headersSent) {
      return renderError(res, 500, "server_error", "Authorization is temporarily unavailable");
    }
    return undefined;
  }
}

async function authorize(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!applyRateLimit(req, res, { keySuffix: "oauth/authorize", maxRequests: 60 })) {
    return;
  }

  const clientId = first(req.query.client_id);
  const redirectUri = first(req.query.redirect_uri);
  const responseType = first(req.query.response_type);
  const codeChallenge = first(req.query.code_challenge);
  const codeChallengeMethod = first(req.query.code_challenge_method);
  const state = first(req.query.state);
  const requestedScope = first(req.query.scope);
  const resource = first(req.query.resource);

  if (!clientId || !redirectUri) {
    return renderError(res, 400, "invalid_request", "client_id and redirect_uri are required");
  }

  const client = await resolveClient(clientId);
  if (!client) {
    return renderError(res, 400, "invalid_client", "Unknown or unresolvable client_id");
  }

  const matchedRedirect = findMatchingRedirectUri(client, redirectUri);
  if (!matchedRedirect) {
    // An unvalidated redirect_uri must never be redirected to — that would turn
    // this endpoint into an open redirector and leak codes to the attacker.
    return renderError(res, 400, "invalid_request", "redirect_uri is not registered for this client");
  }

  // Defence in depth: registration already rejects anything that is not https
  // or loopback http, but this is the last point before the value is signed
  // into a handle and later handed to the browser, so re-check the scheme here
  // rather than trust that every current and future registration path filtered.
  if (!isAcceptableRedirectUri(matchedRedirect)) {
    return renderError(res, 400, "invalid_request", "redirect_uri scheme is not permitted");
  }

  // From here the redirect target is trusted, so errors go back to the client
  // per RFC 6749 §4.1.2.1 instead of being rendered.
  const bounce = (error: string, description: string) =>
    redirectWithError(res, matchedRedirect, error, description, state, issuerOrigin(req));

  if (responseType !== "code") {
    return bounce("unsupported_response_type", "Only response_type=code is supported");
  }
  if (!codeChallenge || !isValidCodeChallenge(codeChallenge)) {
    return bounce("invalid_request", "A valid S256 code_challenge is required");
  }
  if (codeChallengeMethod !== "S256") {
    // OAuth 2.1 removes `plain`; there is no downgrade path.
    return bounce("invalid_request", "code_challenge_method must be S256");
  }

  const scopes = resolveScopes(requestedScope);
  if (scopes.length === 0) {
    return bounce("invalid_scope", `Supported scopes: ${MCP_SCOPES.join(" ")}`);
  }

  // RFC 8707. Clients MUST send `resource`; when they do it must name this
  // server, or the token would be minted for an audience we do not serve.
  const canonicalResource = resourceUrl(req);
  if (resource && resource.replace(/\/$/, "") !== canonicalResource) {
    return bounce("invalid_target", `Unknown resource. Expected ${canonicalResource}`);
  }

  const handle = encodeAuthorizationRequest({
    clientId: client.clientId,
    clientName: client.clientName,
    redirectUri: matchedRedirect,
    codeChallenge,
    scopes,
    resource: canonicalResource,
    ...(state ? { state } : {}),
  });

  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, `/oauth/consent?request=${encodeURIComponent(handle)}`);
}

/**
 * Narrow the requested scopes to ones we actually serve.
 *
 * A client that sends no `scope` gets the read-only default rather than
 * everything — Claude Code omits the parameter when the server does not
 * advertise one in its challenge, and silently granting write access there
 * would be wrong.
 */
function resolveScopes(requested: string | undefined): McpScope[] {
  if (!requested) return ["wallets:read"];
  const asked = new Set(requested.split(/\s+/).filter(Boolean));
  return MCP_SCOPES.filter((scope) => asked.has(scope) && isMcpScope(scope));
}

function redirectWithError(
  res: NextApiResponse,
  redirectUri: string,
  error: string,
  description: string,
  state: string | undefined,
  issuer: string,
) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  // RFC 9207: include `iss` on error responses too, so a client can tell which
  // authorization server answered.
  url.searchParams.set("iss", issuer);
  if (state) url.searchParams.set("state", state);
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, url.toString());
}

function renderError(
  res: NextApiResponse,
  status: number,
  error: string,
  description: string,
) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ error, error_description: description });
}
