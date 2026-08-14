import jwt from "jsonwebtoken";

import type { McpScope } from "@/lib/mcp/scopes";

const { sign, verify } = jwt;

/**
 * The pending-authorization handle.
 *
 * `/api/oauth/authorize` validates a request, then hands the browser a signed,
 * short-lived description of it and redirects to the consent page. The consent
 * page cannot alter it, and `/api/oauth/decision` re-verifies it before issuing
 * a code.
 *
 * This is what binds an approval to a *specific* client, scope set and redirect
 * URI. The wallet-session cookie alone only proves "this wallet is present in
 * this browser" — it carries no notion of what is being approved, so consent
 * must never be inferred from the cookie by itself.
 */

const HANDLE_TYPE = "mcp_ar";
const HANDLE_TTL_SECONDS = 10 * 60;

export type AuthorizationRequest = {
  typ: typeof HANDLE_TYPE;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: McpScope[];
  resource: string;
  state?: string;
};

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is not defined");
  return value;
}

export function encodeAuthorizationRequest(
  request: Omit<AuthorizationRequest, "typ">,
): string {
  return sign({ ...request, typ: HANDLE_TYPE }, secret(), {
    expiresIn: HANDLE_TTL_SECONDS,
  });
}

export function decodeAuthorizationRequest(
  handle: string,
): AuthorizationRequest | null {
  try {
    const claims = verify(handle, secret()) as AuthorizationRequest;
    if (claims.typ !== HANDLE_TYPE) return null;
    if (typeof claims.clientId !== "string") return null;
    if (typeof claims.redirectUri !== "string") return null;
    if (!Array.isArray(claims.scopes)) return null;
    return claims;
  } catch {
    return null;
  }
}
