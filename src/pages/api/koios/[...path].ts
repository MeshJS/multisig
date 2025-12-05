import type { NextApiRequest, NextApiResponse } from "next";
import { cors } from "@/lib/cors";
import { buffer } from "micro";

// Disable automatic body parsing so we can handle raw CBOR and JSON bodies ourselves
export const config = {
  api: {
    bodyParser: false,
  },
};

const KOIOS_BASE_URL = "https://sancho.koios.rest/api/v1";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  console.log("---- KOIOS PROXY REQUEST ----");
  console.log(`${req.method} ${req.url}`);
  
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
  console.log(`Proxying to: ${targetUrl}`);
  
  // Log basic info for POST requests (body is read as raw buffer later)
  if (req.method === "POST") {
    console.log("Incoming POST to Koios proxy (body will be read as raw buffer)");
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    // Prepare headers
    const headers: HeadersInit = {
      "Accept": "application/json",
      "User-Agent": "multisig-app/1.0",
    };

    // For POST requests, forward Content-Type from the original request
    if (req.method === "POST" && req.headers["content-type"]) {
      headers["Content-Type"] = req.headers["content-type"];
    }

    // Prepare fetch options
    const fetchOptions: RequestInit = {
      method: req.method,
      signal: controller.signal,
      headers,
    };

    // For POST requests, include the raw body
    if (req.method === "POST") {
      const contentType = req.headers["content-type"] || "";

      // Read the raw body once
      const rawBody = await buffer(req);

      if (contentType.includes("application/cbor")) {
        // Forward raw CBOR bytes as-is
        fetchOptions.body = rawBody as any;
        headers["Content-Type"] = "application/cbor";
        console.log(
          "Forwarding CBOR body to Koios:",
          `size=${rawBody.byteLength} bytes`,
        );
      } else {
        // For JSON or other text-based content, forward the body unchanged
        fetchOptions.body = rawBody as any;
        if (contentType) {
          headers["Content-Type"] = contentType;
        } else {
          headers["Content-Type"] = "application/json";
        }
        console.log(
          "Forwarding non-CBOR body to Koios:",
          `size=${rawBody.byteLength} bytes`,
          `content-type=${headers["Content-Type"]}`,
        );
      }
    }

    const response = await fetch(targetUrl, fetchOptions);

    clearTimeout(timeout);

    console.log(`Koios response: ${response.status} ${response.statusText}`);

    // Koios API returns 200 or 202 for success
    if (!response.ok && response.status !== 202) {
      const errorText = await response.text().catch(() => response.statusText);
      console.log("Koios error response:", errorText);
      return res.status(response.status).json({
        error: `Koios API error: ${errorText}`,
      });
    }

    // Handle response based on content type
    const responseContentType = response.headers.get("content-type");
    console.log("Response content type:", responseContentType);
    
    if (responseContentType?.includes("application/json")) {
      const data = await response.json();
      console.log(`Response data: ${Array.isArray(data) ? `Array[${data.length}]` : typeof data}`);
      
      // Log first few items for arrays to see structure
      if (Array.isArray(data) && data.length > 0) {
        console.log("Sample response item:", JSON.stringify(data[0], null, 2));
      } else if (typeof data === 'object' && data !== null) {
        console.log("Response object keys:", Object.keys(data));
      }
      
      res.setHeader("Content-Type", "application/json");
      return res.status(response.status).json(data);
    } else {
      // For non-JSON responses (e.g., CBOR), return as-is
      const arrayBuffer = await response.arrayBuffer();
      console.log(`Binary response size: ${arrayBuffer.byteLength} bytes`);
      if (responseContentType) {
        res.setHeader("Content-Type", responseContentType);
      }
      return res.status(response.status).send(Buffer.from(arrayBuffer));
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.log("Request timeout");
      return res.status(504).json({ error: "Request timeout" });
    }
    console.error("Koios proxy error:", error);
    return res.status(500).json({ error: "Failed to proxy request to Koios API" });
  } finally {
    console.log("---- KOIOS PROXY END ----");
  }
}

