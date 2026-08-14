import { createHash, timingSafeEqual } from "crypto";

/**
 * PKCE (RFC 7636), S256 only.
 *
 * OAuth 2.1 removes the `plain` challenge method, and the MCP specification
 * requires clients to use S256 whenever they are technically capable. Accepting
 * `plain` would let anyone who intercepts an authorization code redeem it, which
 * is the entire attack PKCE exists to prevent — so it is simply not implemented.
 */

/** base64url without padding, per RFC 7636 Appendix A. */
function base64UrlSha256(input: string): string {
  return createHash("sha256").update(input, "ascii").digest("base64url");
}

/** A code_verifier must be 43-128 chars from the unreserved set (RFC 7636 §4.1). */
export function isValidCodeVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
}

/** A code_challenge is the base64url SHA-256 of a verifier: 43 chars, no padding. */
export function isValidCodeChallenge(challenge: string): boolean {
  return /^[A-Za-z0-9\-_]{43}$/.test(challenge);
}

/**
 * Constant-time check that `verifier` produced `challenge`.
 *
 * Both strings are fixed-length base64url once hashed, so a length mismatch can
 * be rejected early without leaking anything useful.
 */
export function verifyCodeChallenge(
  verifier: string,
  challenge: string,
): boolean {
  if (!isValidCodeVerifier(verifier)) return false;

  const computed = base64UrlSha256(verifier);
  if (computed.length !== challenge.length) return false;

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
  } catch {
    return false;
  }
}
