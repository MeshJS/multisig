/**
 * Pure helpers for the `/api/ekklesia/*` proxy (src/pages/api/ekklesia/[...path].ts).
 *
 * The proxy sits on our own origin, so the browser attaches *every* cookie of
 * this site to requests it makes — including `mesh_wallet_session` and the
 * NextAuth session token. Forwarding the raw `Cookie` header handed those
 * credentials to a third party. Instead, Ekklesia's cookies are namespaced:
 * on the way back they are renamed with {@link EKKLESIA_COOKIE_PREFIX} and
 * scoped to {@link EKKLESIA_COOKIE_PATH}, and on the way out only cookies
 * carrying that prefix are forwarded, with the prefix stripped. Ekklesia sees
 * exactly the cookies it set; our own never leave the origin.
 */

export const EKKLESIA_COOKIE_PREFIX = "ekklesia_";
export const EKKLESIA_COOKIE_PATH = "/api/ekklesia";
/**
 * Ekklesia sets one session cookie. Browsers cap cookies per site, so an
 * upstream flooding Set-Cookie could evict our own session cookies; keep a
 * small margin above what the API actually sends.
 */
export const MAX_EKKLESIA_SET_COOKIES = 5;

/**
 * Build the upstream URL for a proxied path, or null when the path would
 * leave the configured base (`..`, `.`, empty or slash-bearing segments).
 * The base host is fixed by env, but without this a `..` segment reaches any
 * path on that host with the caller's Ekklesia credentials attached.
 */
export function buildUpstreamUrl(
  base: string,
  segments: string[],
  query: URLSearchParams,
): URL | null {
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      /[/\\]/.test(segment)
    ) {
      return null;
    }
  }

  const baseUrl = new URL(base);
  const basePath = baseUrl.pathname.replace(/\/+$/, "");
  const url = new URL(
    `${basePath}/${segments.map(encodeURIComponent).join("/")}`,
    baseUrl.origin,
  );
  // Defence in depth: whatever the URL parser made of the path, it must still
  // be on the base origin and under the base path.
  if (url.origin !== baseUrl.origin) return null;
  if (!url.pathname.startsWith(`${basePath}/`)) return null;

  const qs = query.toString();
  if (qs) url.search = qs;
  return url;
}

/**
 * Turn the browser's `Cookie` header into the one Ekklesia should see: only
 * our namespaced Ekklesia cookies, with the namespace removed. Returns null
 * when there is nothing to forward.
 */
export function upstreamCookieHeader(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const forwarded: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const pair = part.trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    if (!name.startsWith(EKKLESIA_COOKIE_PREFIX)) continue;
    const upstreamName = name.slice(EKKLESIA_COOKIE_PREFIX.length);
    if (!upstreamName) continue;
    forwarded.push(`${upstreamName}=${pair.slice(eq + 1)}`);
  }
  return forwarded.length > 0 ? forwarded.join("; ") : null;
}

/**
 * Rewrite one upstream `Set-Cookie` so it lands in our namespace: prefix the
 * name, pin `Path` to the proxy, and drop `Domain` (an Ekklesia domain would
 * be rejected on our origin anyway; any other value must not be honoured).
 * `HttpOnly` is always set: the client authenticates with the bearer token,
 * never by reading the cookie, so script on our origin has no need to see
 * Ekklesia's JWT. Other attributes (Secure, SameSite, Max-Age, Expires) are
 * kept as Ekklesia sent them. Returns null for a malformed cookie.
 */
export function rewriteSetCookie(setCookie: string): string | null {
  const [pair = "", ...attributes] = setCookie.split(";");
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  if (!name) return null;
  const value = pair.slice(eq + 1).trim();

  const kept = attributes
    .map((a) => a.trim())
    .filter((a) => {
      const key = a.split("=")[0]?.trim().toLowerCase();
      return a !== "" && key !== "path" && key !== "domain" && key !== "httponly";
    });

  return [
    `${EKKLESIA_COOKIE_PREFIX}${name}=${value}`,
    ...kept,
    "HttpOnly",
    `Path=${EKKLESIA_COOKIE_PATH}`,
  ].join("; ");
}
