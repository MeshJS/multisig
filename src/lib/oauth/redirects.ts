import type { OAuthClient } from "@prisma/client";

/**
 * Pure redirect-URI and client-id logic — no database, no network.
 *
 * Split out from `clients.ts` deliberately. That module imports `@/server/db`,
 * which eagerly constructs a Prisma client and pg pool at import time (see the
 * note in `jest.config.mjs` about modules with import-time side effects). Any
 * consumer that only needs to reason about URLs — including tests — should be
 * able to do so without dragging a database connection along.
 */

/** Hard cap on how many redirect URIs any client may register. */
export const MAX_REDIRECT_URIS = 10;

/** A CIMD client_id must be an https URL with a path component. */
export function isMetadataUrlClientId(clientId: string): boolean {
  try {
    const url = new URL(clientId);
    // Default port only: the CIMD fetch is an SSRF sink, and allowing an
    // explicit port would let a client_id probe arbitrary services on any
    // public host. URL normalises ":443" away, so "" means the default.
    return (
      url.protocol === "https:" && url.port === "" && url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

/**
 * Is this a redirect URI we are willing to send a browser to?
 *
 * https everywhere, except loopback http — which RFC 8252 requires for native
 * apps, and which Claude Code uses with an ephemeral port.
 *
 * **Every** registration path must apply this. It previously existed only
 * inside the DCR handler, which left the Client ID Metadata Document path
 * accepting any string: a `javascript:` URI registered that way flows through
 * `findMatchingRedirectUri` (exact-string match, so it matches itself), into the
 * signed request handle, and out to `window.location.href` on the consent page —
 * script execution on this origin. The app ships no CSP, so nothing else would
 * have caught it.
 */
export function isAcceptableRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]")
  );
}

/**
 * Redirect URI matching.
 *
 * Exact string match, with one carve-out: RFC 8252 loopback redirects. A native
 * client binds an ephemeral port at runtime and cannot know it at registration
 * time, so `http://127.0.0.1:51763/callback` must match a registered
 * `http://127.0.0.1/callback`. The port — and only the port — is ignored, and
 * only for literal loopback hosts.
 */
export function redirectUriMatches(
  registered: string,
  requested: string,
): boolean {
  if (registered === requested) return true;

  let reg: URL;
  let req: URL;
  try {
    reg = new URL(registered);
    req = new URL(requested);
  } catch {
    return false;
  }

  const isLoopback = (u: URL) =>
    u.protocol === "http:" &&
    (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]");

  if (!isLoopback(reg) || !isLoopback(req)) return false;

  return (
    reg.hostname === req.hostname &&
    reg.pathname === req.pathname &&
    reg.search === req.search
  );
}

export function findMatchingRedirectUri(
  client: Pick<OAuthClient, "redirectUris">,
  requested: string,
): string | null {
  for (const registered of client.redirectUris) {
    if (redirectUriMatches(registered, requested)) return requested;
  }
  return null;
}
