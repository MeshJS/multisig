import type { NextApiRequest, NextApiResponse } from "next";
import { extractCidPath, ipfsGatewayBases } from "@/lib/ipfs";
import { applyRateLimit } from "@/lib/security/requestGuards";

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
// Per-IP ceiling. Higher than the 60/min default because the DRep vote-history
// CSV export resolves every rationale in a burst (fetchIpfsJson waits out a 429
// and retries). Successful responses are CDN-cached for a day, so repeat views
// mostly never reach this function.
const RATE_LIMIT_PER_MINUTE = 120;

/** The upstream body exceeded MAX_BYTES (declared or actually streamed). */
class ContentTooLargeError extends Error {}

/**
 * Read a response body, giving up as soon as it passes `maxBytes`.
 *
 * WHY: the caller picks the CID, so it can point us at any multi-gigabyte file
 * on IPFS. `arrayBuffer()` would buffer all of it in the function's memory
 * before the size check ran. A declared Content-Length over the cap is
 * rejected without reading; otherwise the stream is cancelled the moment the
 * running total crosses the cap (Content-Length can be absent or lie).
 */
async function readCapped(upstream: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await upstream.body?.cancel().catch(() => undefined);
    throw new ContentTooLargeError();
  }
  if (!upstream.body) return Buffer.alloc(0);

  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ContentTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

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
      // Release the connection: the redirect body is never read.
      await res.body?.cancel().catch(() => undefined);
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
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (
    !applyRateLimit(req, res, {
      keySuffix: "ipfs/resolve",
      maxRequests: RATE_LIMIT_PER_MINUTE,
    })
  ) {
    return;
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
    // The timer stays armed through the body read (cleared in `finally`): a
    // gateway that sends headers promptly and then trickles the body must not
    // hold the request open past the per-gateway budget.
    let buf: Buffer;
    try {
      const upstream = await fetchGuarded(base + cidPath, allowed, controller.signal);
      if (!upstream || !upstream.ok) {
        await upstream?.body?.cancel().catch(() => undefined);
        continue;
      }
      buf = await readCapped(upstream, MAX_BYTES);
    } catch (error) {
      // The same CID is the same bytes on every gateway, so another gateway
      // would only return the same oversized file.
      if (error instanceof ContentTooLargeError) {
        return res.status(413).json({ error: "IPFS content too large" });
      }
      continue; // timeout or network error: try the next gateway
    } finally {
      clearTimeout(timeout);
    }

    // The proxy only serves rationale/metadata JSON. Pin the content type and
    // forbid MIME sniffing so a hostile gateway can't get HTML/JS executed.
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // This response is CDN-cached for a day; the first caller's per-IP quota
    // must not be replayed to everyone who gets the cached copy.
    for (const name of ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]) {
      res.removeHeader(name);
    }
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=86400, max-age=3600, stale-while-revalidate=604800",
    );
    return res.send(buf);
  }

  return res
    .status(504)
    .json({ error: "All IPFS gateways failed to resolve the content" });
}
