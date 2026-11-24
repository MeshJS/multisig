/** Only migrate known landing fragments; preserve query strings verbatim. */
export function legacyResourceDestination(asPath: string): string | null {
  const hashAt = asPath.indexOf("#");
  if (hashAt < 0) return null;
  const base = asPath.slice(0, hashAt);
  const queryAt = base.indexOf("?");
  const path = queryAt < 0 ? base : base.slice(0, queryAt);
  const query = queryAt < 0 ? "" : base.slice(queryAt);
  const hash = asPath.slice(hashAt);
  if ((path === "/" || path === "/about") && hash === "#connect-mcp") {
    return `/docs/mcp${query}`;
  }
  if (path === "/" && hash === "#developers-and-bots") {
    return `/about${query}#developers-and-bots`;
  }
  return null;
}
