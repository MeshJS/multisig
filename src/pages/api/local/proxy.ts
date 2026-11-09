import type { NextApiRequest, NextApiResponse } from "next";
import { checkRateLimit, getClientIP } from "@/lib/security/rateLimit";
import { validateOrigin, validateUrlParameter } from "@/lib/security/validation";
import { isAllowedDomain, ALLOWED_HOSTNAMES } from "@/lib/security/domains";
import { cappedFetch, CappedFetchError, isImageContentType } from "@/lib/security/cappedFetch";

// This endpoint exists to show dApp og:images and favicons. Passing through
// anything else (an HTML page, a script) would serve another site's content
// as our origin, so only images are relayed, and only up to a size an image
// on a card plausibly needs (the live ones are 1-130 KB).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const PROXY_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Validate origin
  if (!validateOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }
  
  // Rate limiting (higher limits for development)
  const clientIP = getClientIP(req);
  const isDevelopment = process.env.NODE_ENV === 'development';
  const maxRequests = isDevelopment ? 200 : 20; // 200/min in dev, 20/min in prod
  if (!checkRateLimit(clientIP, maxRequests, 60 * 1000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  
  const src = req.query.src as string | undefined;
  const srcValidation = validateUrlParameter(src, 'src');
  if (!srcValidation.isValid) {
    return res.status(400).json({ error: srcValidation.error });
  }
  
  // At this point, src is guaranteed to be a string
  const validatedSrc = src as string;
  
  if (!isAllowedDomain(validatedSrc)) {
    return res.status(400).json({ error: "Domain not allowed" });
  }
  
  // Additional inline SSRF protection for CodeQL
  let targetHostname: string;
  try {
    const parsedUrl = new URL(validatedSrc);
    targetHostname = parsedUrl.hostname.toLowerCase();
    
    // Only allow HTTP/HTTPS protocols
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: "Invalid protocol" });
    }
  } catch {
    return res.status(400).json({ error: "Invalid URL format" });
  }
  
  // Strict hostname allow-list check
  if (!ALLOWED_HOSTNAMES.includes(targetHostname)) {
    return res.status(400).json({ error: "Domain not allowed" });
  }
  try {
    const { contentType, body } = await cappedFetch(validatedSrc, {
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: 10000,
      overflow: "reject",
      acceptContentType: isImageContentType,
      headers: { "user-agent": "Mozilla/5.0" },
    });

    res.setHeader("Content-Type", contentType);
    // The bytes come from another site but are served from our origin. An SVG
    // opened directly (not via <img>) is a document and would run its scripts
    // as us; the sandbox CSP gives it an opaque origin with scripts off, while
    // <img> rendering, the only use the dApp cards make of it, is unaffected.
    res.setHeader("Content-Security-Policy", PROXY_CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Optimize cache headers for CDN/edge caching
    res.setHeader("Cache-Control", "public, s-maxage=3600, max-age=3600, stale-while-revalidate=7200");
    res.send(body);
  } catch (error) {
    // An upstream that misses the deadline is a gateway timeout, not a fault
    // of ours; reporting it as 500 made a slow dApp site look like our outage.
    if (error instanceof Error && error.name === "AbortError") {
      return res.status(504).json({ error: "Upstream timed out" });
    }
    if (error instanceof CappedFetchError) {
      return res.status(502).json({ error: error.message });
    }
    res.status(500).json({ error: "Proxy fetch failed" });
  }
}
