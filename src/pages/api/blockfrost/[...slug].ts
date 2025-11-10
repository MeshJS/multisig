import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";

interface NetworkConfig {
  key: string;
  baseUrl: string;
}

function getNetworkConfig(network: string): NetworkConfig | null {
  switch (network) {
    case "mainnet":
      // Use server-side key if available, otherwise fall back to client-side key
      const mainnetKey =
        env.BLOCKFROST_API_KEY_MAINNET ??
        env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET;
      if (!mainnetKey) return null;
      return {
        key: mainnetKey,
        baseUrl: "https://cardano-mainnet.blockfrost.io/api/v0",
      };
    default: // preprod
      // Use server-side key if available, otherwise fall back to client-side key
      const preprodKey =
        env.BLOCKFROST_API_KEY_PREPROD ??
        env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD;
      if (!preprodKey) return null;
      return {
        key: preprodKey,
        baseUrl: "https://cardano-preprod.blockfrost.io/api/v0",
      };
  }
}

function getQueryString(url: string | undefined): string {
  if (!url) return "";
  const qIndex = url.indexOf("?");
  return qIndex !== -1 ? url.substring(qIndex) : "";
}

function isCBOREndpoint(endpointPath: string): boolean {
  return endpointPath === "tx/submit" || endpointPath === "utils/txs/evaluate";
}

function convertToBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  
  if (typeof data === "string") {
    // Check if it's a hex string (even length, only hex characters)
    const hexPattern = /^[0-9a-fA-F]+$/;
    if (data.length % 2 === 0 && hexPattern.test(data)) {
      // Try to convert hex string to buffer
      try {
        return Buffer.from(data, "hex");
      } catch (e) {
        // If conversion fails, treat as regular string
        return Buffer.from(data, "utf-8");
      }
    }
    // Regular string - convert to UTF-8 buffer
    return Buffer.from(data, "utf-8");
  }
  
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  
  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }
  
  // Fallback: try to stringify and convert
  return Buffer.from(JSON.stringify(data), "utf-8");
}

async function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      reject(error);
    });
  });
}

// Disable body parsing for all requests - we'll handle it manually
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const slug = req.query.slug as string[] | undefined;
    if (!slug || slug.length === 0) {
      return res.status(400).json({ error: "Network parameter is required" });
    }

    const network = slug[0]!; // Safe because we checked slug.length > 0
    const networkConfig = getNetworkConfig(network);

    if (!networkConfig || !networkConfig.key) {
      return res.status(500).json({
        error: `Missing Blockfrost API key for network: ${network}`,
      });
    }

    // Construct endpoint - detect CBOR endpoints early
    const endpointPath = slug.slice(1).join("/") || "";
    const queryString = getQueryString(req.url ?? "");
    const endpoint = endpointPath + queryString;
    const isCBOR = isCBOREndpoint(endpointPath);

    // Set headers
    const headers: Record<string, string> = {
      project_id: networkConfig.key,
    };

    if (isCBOR) {
      headers["Content-Type"] = "application/cbor";
    } else {
      headers["Content-Type"] = "application/json";
    }

    // Handle request body based on endpoint type
    let requestBody: BodyInit | undefined = undefined;
    
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (isCBOR) {
        // For CBOR endpoints, read raw body and convert to buffer
        try {
          const rawBody = await getRawBody(req);
          const buffer = convertToBuffer(rawBody);
          // Convert Buffer to Uint8Array for fetch API compatibility
          requestBody = new Uint8Array(buffer);
        } catch (error) {
          console.error("Error reading raw body for CBOR endpoint:", error);
          return res.status(400).json({
            error: "Failed to read request body for CBOR endpoint",
          });
        }
      } else {
        // For JSON endpoints, parse the body as text
        try {
          const rawBody = await getRawBody(req);
          const bodyText = rawBody.toString("utf-8");
          if (bodyText) {
            requestBody = bodyText;
          }
        } catch (error) {
          console.error("Error reading body for JSON endpoint:", error);
          // Continue without body if reading fails
        }
      }
    }

    // Forward request to Blockfrost
    const url = `${networkConfig.baseUrl}/${endpoint}`;
    const blockfrostResponse = await fetch(url, {
      method: req.method,
      headers,
      body: requestBody,
    });

    // Handle 404 for UTXOs as empty wallet
    if (blockfrostResponse.status === 404 && endpointPath.includes("/utxos")) {
      return res.status(200).json([]);
    }

    // Handle errors
    if (!blockfrostResponse.ok) {
      const errorBody = await blockfrostResponse.text();
      return res.status(blockfrostResponse.status).json({
        error: `Blockfrost API error: ${blockfrostResponse.status} ${blockfrostResponse.statusText}`,
        details: errorBody,
      });
    }

    // Handle CBOR endpoints
    if (isCBOR) {
      const responseData = await blockfrostResponse.text();
      return res.status(blockfrostResponse.status).json(responseData);
    }

    // Handle JSON responses
    const responseData = await blockfrostResponse.json();
    return res.status(200).json(responseData);
  } catch (error: unknown) {
    console.error("Blockfrost API route error:", error);
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    return res.status(500).json({ error: errorMessage });
  }
}
