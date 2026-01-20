import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";

interface ShortenResponse {
  shortUrl: string;
  originalUrl: string;
}

interface ErrorResponse {
  error: string;
}

// Generate a short ID (8 characters)
function generateShortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ShortenResponse | ErrorResponse>,
) {
  if (req.method === "POST") {
    const { url } = req.body;

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      console.log("[shorten-url] Processing URL:", url);
      console.log("[shorten-url] Host header:", req.headers.host);

      // For localhost development, use a simple hash-based approach as fallback
      if (req.headers.host?.includes('localhost')) {
        console.log("[shorten-url] Using localhost fallback mode");
        
        // Create a simple hash of the URL for consistent short IDs
        const hash = Buffer.from(url).toString('base64')
          .replace(/[+/=]/g, '')
          .substring(0, 8);
        
        const shortUrl = `${req.headers.host}/s/${hash}`;
        console.log("[shorten-url] Generated localhost short URL:", shortUrl);
        
        return res.status(200).json({
          shortUrl,
          originalUrl: url,
        });
      }

      // Try database approach for production
      console.log("[shorten-url] Database client:", typeof db);
      console.log("[shorten-url] Database urlShortener:", typeof db.urlShortener);

      // Check if URL already exists
      const existing = await db.urlShortener.findFirst({
        where: { originalUrl: url },
      });

      if (existing) {
        const shortUrl = `${req.headers.host}/s/${existing.shortId}`;
        console.log("[shorten-url] Found existing short URL:", shortUrl);
        return res.status(200).json({
          shortUrl,
          originalUrl: url,
        });
      }

      // Generate new short ID
      let shortId = generateShortId();
      console.log("[shorten-url] Generated initial short ID:", shortId);
      
      // Ensure uniqueness
      let attempts = 0;
      while (await db.urlShortener.findUnique({ where: { shortId } })) {
        shortId = generateShortId();
        attempts++;
        if (attempts > 10) {
          throw new Error("Failed to generate unique short ID after 10 attempts");
        }
      }

      console.log("[shorten-url] Final unique short ID:", shortId);

      // Store in database
      const created = await db.urlShortener.create({
        data: {
          shortId,
          originalUrl: url,
        },
      });

      console.log("[shorten-url] Created database record:", created.id);

      const shortUrl = `${req.headers.host}/s/${shortId}`;
      console.log("[shorten-url] Returning short URL:", shortUrl);
      
      return res.status(200).json({
        shortUrl,
        originalUrl: url,
      });
    } catch (error) {
      console.error("[shorten-url] Error details:", error);
      
      // Fallback for any database errors in localhost
      if (req.headers.host?.includes('localhost')) {
        console.log("[shorten-url] Database error in localhost, using hash fallback");
        const hash = Buffer.from(url).toString('base64')
          .replace(/[+/=]/g, '')
          .substring(0, 8);
        
        const shortUrl = `${req.headers.host}/s/${hash}`;
        return res.status(200).json({
          shortUrl,
          originalUrl: url,
        });
      }
      
      return res.status(500).json({ 
        error: "Failed to shorten URL", 
        details: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  }

  if (req.method === "GET") {
    const { shortId } = req.query;

    if (!shortId || typeof shortId !== "string") {
      return res.status(400).json({ error: "Short ID is required" });
    }

    try {
      const urlRecord = await db.urlShortener.findUnique({
        where: { shortId },
      });

      if (!urlRecord) {
        return res.status(404).json({ error: "Short URL not found" });
      }

      return res.status(200).json({
        shortUrl: `${req.headers.host}/s/${shortId}`,
        originalUrl: urlRecord.originalUrl,
      });
    } catch (error) {
      console.error("URL lookup error:", error);
      return res.status(500).json({ error: "Failed to lookup URL" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
