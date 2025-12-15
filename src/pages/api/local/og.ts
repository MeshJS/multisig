import type { NextApiRequest, NextApiResponse } from "next";
import { checkRateLimit, getClientIP } from "@/lib/security/rateLimit";
import { validateOrigin, validateUrlParameter } from "@/lib/security/validation";
import { isAllowedDomain, ALLOWED_HOSTNAMES } from "@/lib/security/domains";

function extractMeta(html: string, property: string): string | null {
  const propRegex = new RegExp(`<meta[^>]+property=["']${property}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const nameRegex = new RegExp(`<meta[^>]+name=["']${property}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const propMatch = propRegex.exec(html);
  if (propMatch?.[1]) return propMatch[1];
  const nameMatch = nameRegex.exec(html);
  if (nameMatch?.[1]) return nameMatch[1];
  return null;
}

function extractTwitterMeta(html: string, property: string): string | null {
  const twitterRegex = new RegExp(`<meta[^>]+name=["']twitter:${property}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const match = twitterRegex.exec(html);
  return match?.[1] ?? null;
}

function extractLink(html: string, rel: string): string | null {
  const regex = new RegExp(`<link[^>]+rel=["'][^"']*${rel}[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>`, "i");
  const match = regex.exec(html);
  return match?.[1] ?? null;
}

function extractTitle(html: string): string | null {
  const ogTitle = extractMeta(html, "og:title");
  if (ogTitle) return ogTitle;
  const twitterTitle = extractTwitterMeta(html, "title");
  if (twitterTitle) return twitterTitle;
  const titleRegex = /<title[^>]*>([^<]+)<\/title>/i;
  const titleMatch = titleRegex.exec(html);
  return titleMatch?.[1] ?? null;
}

function extractDescription(html: string): string | null {
  const ogDesc = extractMeta(html, "og:description");
  if (ogDesc) return ogDesc;
  const twitterDesc = extractTwitterMeta(html, "description");
  if (twitterDesc) return twitterDesc;
  const metaDesc = extractMeta(html, "description");
  return metaDesc;
}

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
  const maxRequests = isDevelopment ? 100 : 10; // 100/min in dev, 10/min in prod
  if (!checkRateLimit(clientIP, maxRequests, 60 * 1000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  
  const url = req.query.url as string | undefined;
  const urlValidation = validateUrlParameter(url, 'url');
  if (!urlValidation.isValid) {
    return res.status(400).json({ error: urlValidation.error });
  }
  
  // At this point, url is guaranteed to be a string
  const validatedUrl = url as string;
  
  if (!isAllowedDomain(validatedUrl)) {
    return res.status(400).json({ error: "Domain not allowed" });
  }
  
  // Additional inline SSRF protection for CodeQL
  let targetHostname: string;
  try {
    const parsedUrl = new URL(validatedUrl);
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(validatedUrl, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0" } });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({ error: `Failed to fetch target (${response.status})` });
    }

    const html = await response.text();
    const base = new URL(validatedUrl);

    const ogImageRaw = extractMeta(html, "og:image") ?? extractTwitterMeta(html, "image");
    const faviconRaw =
      extractLink(html, "icon") ?? extractLink(html, "shortcut icon") ?? extractLink(html, "apple-touch-icon");

    const title = extractTitle(html);
    const description = extractDescription(html);

    const resolveUrl = (u: string | null): string | null => {
      if (!u) return null;
      try {
        return new URL(u, base).toString();
      } catch {
        return null;
      }
    };

    const resolvedImage = resolveUrl(ogImageRaw);
    const resolvedFavicon = resolveUrl(faviconRaw) ?? `${base.origin}/favicon.ico`;

    const proxiedImage = resolvedImage ? `/api/local/proxy?src=${encodeURIComponent(resolvedImage)}` : null;
    const proxiedFavicon = resolvedFavicon ? `/api/local/proxy?src=${encodeURIComponent(resolvedFavicon)}` : null;

    // Set cache headers for OG metadata (1 hour cache)
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=3600, stale-while-revalidate=7200",
    );
    return res.status(200).json({
      title: title ?? null,
      description: description ?? null,
      image: proxiedImage,
      favicon: proxiedFavicon,
    });
  } catch {
    return res.status(500).json({ error: "Unable to fetch OpenGraph data" });
  }
}
