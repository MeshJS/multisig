import { createHash, randomBytes, randomUUID } from "crypto";
import jwt from "jsonwebtoken";

import { parseMcpScopes, type McpScope } from "@/lib/mcp/scopes";
import { ACCESS_TOKEN_TTL_SECONDS } from "@/lib/oauth/config";

const { sign, verify } = jwt;

/**
 * OAuth access tokens — pure crypto, no database.
 *
 * Split from the refresh-token store (`tokens.ts`) for the same reason
 * `redirects.ts` is split from `clients.ts`: that module imports `@/server/db`,
 * which builds a Prisma client at import time. Minting and verifying a token
 * needs no database, and callers (including tests) should not inherit one.
 *
 * Access tokens are self-contained JWTs so the resource server can validate them
 * without a database round trip. Two details keep them from being confused with
 * the v1 bearer tokens that share the same signing secret:
 *
 *  - the subject travels in `sub`, never in `address`, so `verifyJwt` in
 *    `src/lib/verifyJwt.ts` rejects an OAuth token outright; and
 *  - `typ` must be `mcp_at`, so a v1 token cannot be replayed against the MCP
 *    endpoint either.
 *
 * The two token families are therefore non-interchangeable in both directions,
 * despite sharing `JWT_SECRET`.
 */

export const ACCESS_TOKEN_TYPE = "mcp_at";

export type AccessTokenClaims = {
  iss: string;
  sub: string;
  aud: string;
  typ: typeof ACCESS_TOKEN_TYPE;
  /** OAuth client id. */
  cid: string;
  /** Space-delimited granted scopes. */
  scope: string;
  /** Wallet addresses this grant covers. */
  addrs: string[];
  exp: number;
  iat: number;
  jti: string;
};

export type VerifiedAccessToken = {
  subject: string;
  clientId: string;
  scopes: McpScope[];
  addresses: string[];
  expiresAt: number;
};

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is not defined");
  return value;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintAccessToken(args: {
  issuer: string;
  resource: string;
  subject: string;
  clientId: string;
  scopes: readonly McpScope[];
  addresses: string[];
}): { token: string; expiresIn: number } {
  const token = sign(
    {
      sub: args.subject,
      aud: args.resource,
      typ: ACCESS_TOKEN_TYPE,
      cid: args.clientId,
      scope: args.scopes.join(" "),
      addrs: args.addresses,
      jti: randomUUID(),
    },
    secret(),
    { issuer: args.issuer, expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  );
  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Verify an access token against this resource server.
 *
 * Audience validation is the RFC 8707 requirement the MCP spec states as a MUST:
 * a token minted for some other resource must not be accepted here, even though
 * it carries a valid signature from the same authorization server.
 */
export function verifyAccessToken(
  token: string,
  args: { issuer: string; resource: string },
): VerifiedAccessToken | null {
  let claims: AccessTokenClaims;
  try {
    claims = verify(token, secret(), {
      issuer: args.issuer,
      audience: args.resource,
    }) as AccessTokenClaims;
  } catch {
    return null;
  }

  if (claims.typ !== ACCESS_TOKEN_TYPE) return null;
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null;
  if (typeof claims.exp !== "number") return null;

  const addresses = Array.isArray(claims.addrs)
    ? claims.addrs.filter((a): a is string => typeof a === "string")
    : [];
  if (addresses.length === 0) return null;

  return {
    subject: claims.sub,
    clientId: typeof claims.cid === "string" ? claims.cid : "unknown",
    scopes: parseMcpScopes(claims.scope),
    addresses,
    expiresAt: claims.exp,
  };
}

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}
