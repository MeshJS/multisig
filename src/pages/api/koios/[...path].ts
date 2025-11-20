import type { NextApiRequest, NextApiResponse } from "next";
import { cors } from "@/lib/cors";

const KOIOS_BASE_URL = "https://sancho.koios.rest/api/v1";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await cors(req, res);
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only allow GET requests for now
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const path = req.query.path as string[];
  if (!path || path.length === 0) {
    return res.status(400).json({ error: "Missing API path" });
  }

  // Reconstruct the API path
  const apiPath = Array.isArray(path) ? path.join("/") : path;
  
  // Build query string from remaining query params (excluding 'path')
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

  const queryString = queryParams.toString();
  const targetUrl = `${KOIOS_BASE_URL}/${apiPath}${queryString ? `?${queryString}` : ""}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "multisig-app/1.0",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Koios API error: ${response.statusText}`,
      });
    }

    const data = await response.json();
    
    // Forward appropriate headers
    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }

    return res.status(200).json(data);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return res.status(504).json({ error: "Request timeout" });
    }
    console.error("Koios proxy error:", error);
    return res.status(500).json({ error: "Failed to proxy request to Koios API" });
  }
}

