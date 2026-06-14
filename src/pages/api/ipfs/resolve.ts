import type { NextApiRequest, NextApiResponse } from "next";
import { extractCidPath, ipfsGatewayBases } from "@/lib/ipfs";

/**
 * Resolve an IPFS reference (CID, `ipfs://…`, or any `…/ipfs/<cid>` URL) by
 * trying several gateways server-side with a short per-gateway timeout, and
 * return the first success. This shields the browser from the frequent `ipfs.io`
 * 504s/CORS issues. SSRF-safe: every request starts at a fixed, known gateway,
 * only the (validated) CID path is caller-influenced, and redirects are only
 * followed to other known gateway hosts — never to an arbitrary/internal host.
 */
const PER_GATEWAY_TIMEOUT_MS = 6000;
const MAX_BYTES = 2 * 1024 * 1024; // rationale/metadata JSON is tiny
const MAX_REDIRECTS = 3;

/** Hostnames the proxy is allowed to talk to (gateway hosts + subdomain forms). */
function allowedGatewayHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const base of ipfsGatewayBases()) {
    try {
      hosts.add(new URL(base).hostname.toLowerCase());
    } catch {
      // ignore malformed base
    }
  }
  return hosts;
}

/**
 * Some gateways (dweb.link, w3s.link, dedicated Pinata gateways) redirect the
 * path form to a `<cid>.ipfs.<gateway>` subdomain. Allow those, plus any exact
 * gateway host, but nothing else — this is the SSRF guard on redirect targets.
 */
function hostIsAllowed(host: string, allowed: Set<string>): boolean {
  const h = host.toLowerCase();
  if (allowed.has(h)) return true;
  for (const base of allowed) {
    if (h.endsWith(`.ipfs.${base}`) || h.endsWith(`.ipns.${base}`)) return true;
  }
  return false;
}

/**
 * Fetch `startUrl`, following redirects manually and only to allowed gateway
 * hosts over http(s). Returns the final non-redirect Response, or null if a
 * redirect points somewhere disallowed or the hop limit is exceeded.
 */
async function fetchGuarded(
  startUrl: string,
  allowed: Set<string>,
  signal: AbortSignal,
): Promise<Response | null> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      signal,
      redirect: "manual",
      headers: { Accept: "application/json, */*", "user-agent": "Mozilla/5.0" },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, url);
      } catch {
        return null;
      }
      if (nextUrl.protocol !== "https:" && nextUrl.protocol !== "http:") return null;
      if (!hostIsAllowed(nextUrl.hostname, allowed)) return null; // SSRF guard
      url = nextUrl.toString();
      continue;
    }
    return res;
  }
  return null; // too many redirects
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const raw = (req.query.url ?? req.query.cid ?? "") as string;
  const cidPath = extractCidPath(String(raw));
  if (!cidPath) {
    return res.status(400).json({ error: "Invalid or missing IPFS reference" });
  }

  const allowed = allowedGatewayHosts();

  for (const base of ipfsGatewayBases()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PER_GATEWAY_TIMEOUT_MS);
    try {
      const upstream = await fetchGuarded(base + cidPath, allowed, controller.signal);
      clearTimeout(timeout);
      if (!upstream || !upstream.ok) continue;

      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        return res.status(413).json({ error: "IPFS content too large" });
      }
      // The proxy only serves rationale/metadata JSON. Pin the content type and
      // forbid MIME sniffing so a hostile gateway can't get HTML/JS executed.
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=86400, max-age=3600, stale-while-revalidate=604800",
      );
      return res.send(buf);
    } catch {
      clearTimeout(timeout);
      // try the next gateway
    }
  }

  return res
    .status(504)
    .json({ error: "All IPFS gateways failed to resolve the content" });
}
