import type { NextApiRequest, NextApiResponse } from "next";

function extractMeta(html: string, property: string): string | null {
  const propRegex = new RegExp(`<meta[^>]+property=["']${property}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const nameRegex = new RegExp(`<meta[^>]+name=["']${property}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const propMatch = html.match(propRegex);
  if (propMatch && propMatch[1]) return propMatch[1];
  const nameMatch = html.match(nameRegex);
  if (nameMatch && nameMatch[1]) return nameMatch[1];
  return null;
}

function extractTwitterMeta(html: string, property: string): string | null {
  const twitterRegex = new RegExp(`<meta[^>]+name=["']twitter:${property}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const match = html.match(twitterRegex);
  return match && match[1] ? match[1] : null;
}

function extractLink(html: string, rel: string): string | null {
  const regex = new RegExp(`<link[^>]+rel=["'][^"']*${rel}[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>`, "i");
  const match = html.match(regex);
  return match && match[1] ? match[1] : null;
}

function extractTitle(html: string): string | null {
  const ogTitle = extractMeta(html, "og:title");
  if (ogTitle) return ogTitle;
  const twitterTitle = extractTwitterMeta(html, "title");
  if (twitterTitle) return twitterTitle;
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch && titleMatch[1] ? titleMatch[1] : null;
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
  const url = req.query.url as string | undefined;
  if (!url) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0" } });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({ error: `Failed to fetch target (${response.status})` });
    }

    const html = await response.text();
    const base = new URL(url);

    const ogImageRaw = extractMeta(html, "og:image") || extractTwitterMeta(html, "image");
    const faviconRaw =
      extractLink(html, "icon") || extractLink(html, "shortcut icon") || extractLink(html, "apple-touch-icon");

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
    const resolvedFavicon = resolveUrl(faviconRaw) || `${base.origin}/favicon.ico`;

    const proxiedImage = resolvedImage ? `/api/v1/proxy?src=${encodeURIComponent(resolvedImage)}` : null;
    const proxiedFavicon = resolvedFavicon ? `/api/v1/proxy?src=${encodeURIComponent(resolvedFavicon)}` : null;

    return res.status(200).json({
      title: title || null,
      description: description || null,
      image: proxiedImage,
      favicon: proxiedFavicon,
    });
  } catch (error) {
    return res.status(500).json({ error: "Unable to fetch OpenGraph data" });
  }
}
