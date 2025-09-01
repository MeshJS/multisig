import type { NextApiRequest, NextApiResponse } from "next";

// Simple OG metadata extractor using fetch + regex fallbacks
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { url } = req.query;
  if (typeof url !== "string") {
    res.status(400).json({ error: "Missing url" });
    return;
  }

  try {
    const response = await fetch(url, { method: "GET" });
    const html = await response.text();

    const extract = (property: string, nameFallback?: string) => {
      const ogMatch = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"));
      if (ogMatch && ogMatch[1]) return ogMatch[1];
      if (nameFallback) {
        const nameMatch = html.match(new RegExp(`<meta[^>]+name=["']${nameFallback}["'][^>]+content=["']([^"']+)["']`, "i"));
        if (nameMatch && nameMatch[1]) return nameMatch[1];
      }
      return undefined;
    };

    const title = extract("og:title", "title") || (html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? undefined);
    const description = extract("og:description", "description");
    const image = extract("og:image");
    const siteName = extract("og:site_name");

    res.status(200).json({ title, description, image, siteName, url });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Failed to fetch OG" });
  }
}
