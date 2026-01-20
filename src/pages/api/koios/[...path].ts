import type { NextApiRequest, NextApiResponse } from "next";
import { cors } from "@/lib/cors";
import { buffer } from "micro";
import crypto from "crypto";

// Disable automatic body parsing so we can handle raw CBOR and JSON bodies ourselves
export const config = {
  api: {
    bodyParser: false,
  },
};

const KOIOS_BASE_URL = "https://sancho.koios.rest/api/v1";

// Simple in-memory cache with TTL
interface CacheEntry {
  data: unknown;
  contentType: string;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

// Cache TTL in milliseconds (30 seconds for frequently changing data)
const CACHE_TTL: Record<string, number> = {
  account_info: 30000,    // 30 seconds
  drep_info: 30000,       // 30 seconds
  tip: 10000,             // 10 seconds (changes quickly)
  epoch_info: 60000,      // 1 minute
  pool_info: 60000,       // 1 minute
  default: 15000,         // 15 seconds default
};

// Endpoints that should NOT be cached (transactions, submissions)
const NO_CACHE_ENDPOINTS = ["submittx", "ogmios", "tx_submit"];

function getCacheKey(method: string, path: string, body?: string): string {
  const hash = body ? crypto.createHash("md5").update(body).digest("hex") : "";
  return `${method}:${path}:${hash}`;
}

function getTTL(path: string): number {
  for (const [key, ttl] of Object.entries(CACHE_TTL)) {
    if (path.includes(key)) return ttl;
  }
  return CACHE_TTL.default;
}

function shouldCache(path: string): boolean {
  return !NO_CACHE_ENDPOINTS.some((ep) => path.includes(ep));
}

function getFromCache(key: string, ttl: number): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttl) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function setCache(key: string, data: unknown, contentType: string): void {
  // Limit cache size to prevent memory issues
  if (cache.size > 1000) {
    // Delete oldest entries
    const entries = Array.from(cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 100; i++) {
      cache.delete(entries[i][0]);
    }
  }
  cache.set(key, { data, contentType, timestamp: Date.now() });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Ensure we always return JSON, not HTML error pages
  res.setHeader("Content-Type", "application/json");
  
  try {
    await cors(req, res);
    
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    // Allow both GET and POST requests (KoiosProvider uses both)
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const path = req.query.path as string[];
    if (!path || path.length === 0) {
      return res.status(400).json({ error: "Missing API path" });
    }

    // Reconstruct the API path
    const apiPath = Array.isArray(path) ? path.join("/") : path;
    
    // Build query string from remaining query params (excluding 'path') - only for GET
    let queryString = "";
    if (req.method === "GET") {
      const queryParams = new URLSearchParams();
      Object.entries(req.query).forEach(([key, value]) => {
        if (key !== "path" && value) {
          if (Array.isArray(value)) {
            value.forEach((v) => queryParams.append(key, v));
          } else {
            queryParams.append(key, value);
          }
        }
      });
      queryString = queryParams.toString();
    }

    const targetUrl = `${KOIOS_BASE_URL}/${apiPath}${queryString ? `?${queryString}` : ""}`;

    // Read body early for POST (needed for cache key)
    let rawBody: Buffer | undefined;
    let bodyString: string | undefined;
    if (req.method === "POST") {
      rawBody = await buffer(req);
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("application/cbor")) {
        bodyString = rawBody.toString("utf-8");
      }
    }

    // Check cache for cacheable endpoints
    const canCache = shouldCache(apiPath);
    const cacheKey = getCacheKey(req.method, targetUrl, bodyString);
    const ttl = getTTL(apiPath);

    if (canCache) {
      const cached = getFromCache(cacheKey, ttl);
      if (cached) {
        console.log(`[KOIOS CACHE HIT] ${apiPath}`);
        res.setHeader("Content-Type", cached.contentType);
        res.setHeader("X-Cache", "HIT");
        return res.status(200).json(cached.data);
      }
      console.log(`[KOIOS CACHE MISS] ${apiPath}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    // Prepare headers
    const headers: HeadersInit = {
      "Accept": "application/json",
      "User-Agent": "multisig-app/1.0",
    };

    // Prepare fetch options
    const fetchOptions: RequestInit = {
      method: req.method,
      signal: controller.signal,
      headers,
    };

    // For POST requests, include the already-read body
    if (req.method === "POST" && rawBody) {
      const contentType = req.headers["content-type"] || "";
      fetchOptions.body = rawBody as unknown as BodyInit;
      if (contentType.includes("application/cbor")) {
        headers["Content-Type"] = "application/cbor";
      } else {
        headers["Content-Type"] = contentType || "application/json";
      }
    }

    const response = await fetch(targetUrl, fetchOptions);

    clearTimeout(timeout);

    // Koios API returns 200 or 202 for success
    if (!response.ok && response.status !== 202) {
      const errorText = await response.text().catch(() => response.statusText);
      console.log(`[KOIOS ERROR] ${apiPath}: ${response.status}`);
      return res.status(response.status).json({
        error: `Koios API error: ${errorText}`,
      });
    }

    // Handle response based on content type
    const responseContentType = response.headers.get("content-type");
    
    if (responseContentType?.includes("application/json")) {
      const data = await response.json();
      
      // Cache successful JSON responses
      if (canCache) {
        setCache(cacheKey, data, "application/json");
      }
      
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Cache", "MISS");
      return res.status(response.status).json(data);
    } else {
      // For non-JSON responses (e.g., CBOR), return as-is (don't cache)
      const arrayBuffer = await response.arrayBuffer();
      if (responseContentType) {
        res.setHeader("Content-Type", responseContentType);
      }
      return res.status(response.status).send(Buffer.from(arrayBuffer));
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return res.status(504).json({ error: "Request timeout" });
    }
    console.error("[KOIOS ERROR]", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ 
      error: "Failed to proxy request to Koios API",
      details: errorMessage,
    });
  }
}

