import type { NextApiRequest } from "next";

import { MCP_SCOPES } from "@/lib/mcp/scopes";

/**
 * OAuth 2.1 / RFC 8414 / RFC 9728 configuration for the MCP resource server.
 *
 * Issuer identity is deliberately derived from configuration, not from the
 * request `Host` header — a header-derived issuer lets an attacker who controls
 * DNS mint metadata pointing at their own authorization server. The only
 * exception is non-production, where the host is used so a local
 * `next start` on an arbitrary port works without extra configuration.
 */

const DEFAULT_ORIGIN = "https://multisig.meshjs.dev";

/** Path of the MCP endpoint this authorization server protects. */
export const MCP_RESOURCE_PATH = "/api/mcp";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const AUTHORIZATION_CODE_TTL_SECONDS = 60; // OAuth 2.1: SHOULD be <= 10 min

export function issuerOrigin(req?: NextApiRequest): string {
  const configured =
    process.env.OAUTH_ISSUER_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");

  if (process.env.NODE_ENV !== "production" && req?.headers.host) {
    const proto = req.headers.host.startsWith("localhost") ? "http" : "https";
    return `${proto}://${req.headers.host}`;
  }

  return DEFAULT_ORIGIN;
}

/**
 * The canonical RFC 8707 resource identifier. Every access token is bound to
 * this exact string, and the MCP route rejects a token whose `aud` differs.
 */
export function resourceUrl(req?: NextApiRequest): string {
  return `${issuerOrigin(req)}${MCP_RESOURCE_PATH}`;
}

export function protectedResourceMetadataUrl(req?: NextApiRequest): string {
  return `${issuerOrigin(req)}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`;
}

/** RFC 8414 Authorization Server Metadata. */
export function authorizationServerMetadata(req?: NextApiRequest) {
  const origin = issuerOrigin(req);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // S256 only. OAuth 2.1 removes `plain`, and a client that cannot do S256
    // is required by the MCP spec to refuse to proceed rather than downgrade.
    code_challenge_methods_supported: ["S256"],
    // "none" == public client. Claude Code selects Client ID Metadata Documents
    // only when BOTH this and client_id_metadata_document_supported are present;
    // without them it falls back to Dynamic Client Registration.
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/api-docs`,
  };
}

/** RFC 9728 Protected Resource Metadata. */
export function protectedResourceMetadata(req?: NextApiRequest) {
  const origin = issuerOrigin(req);
  return {
    resource: resourceUrl(req),
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Mesh Multisig MCP",
    resource_documentation: `${origin}/api-docs`,
  };
}
