import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";

interface NetworkConfig {
  key: string;
  baseUrl: string;
}

function getNetworkConfig(network: string): NetworkConfig | null {
  switch (network) {
    case "mainnet": {
      // Use server-side key if available, otherwise fall back to client-side key
      const mainnetKey =
        env.BLOCKFROST_API_KEY_MAINNET ??
        env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET;
      if (!mainnetKey) return null;
      return {
        key: mainnetKey,
        baseUrl: "https://cardano-mainnet.blockfrost.io/api/v0",
      };
    }
    case "preprod": {
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
    default:
      return null;
  }
}

/** The networks this proxy serves. Anything else used to fall through to preprod. */
const NETWORKS = new Set(["mainnet", "preprod"]);

/**
 * One path segment as Blockfrost uses them: bech32 addresses and ids, hex
 * hashes, numbers, words like `latest`. Next.js hands us segments already
 * percent-decoded, so without this check `..%2F..` or `%3F` in a segment
 * would rewrite the upstream path or query string.
 */
const SEGMENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

function getQueryString(url: string | undefined): string {
  if (!url) return "";
  const qIndex = url.indexOf("?");
  return qIndex !== -1 ? url.substring(qIndex) : "";
}

function isCBOREndpoint(endpointPath: string): boolean {
  return endpointPath === "tx/submit" || endpointPath === "utils/txs/evaluate";
}

/**
 * The only Blockfrost endpoints the client (Mesh's BlockfrostProvider, used by
 * the UTXOS wallet) ever POSTs to. Every other proxied call is a GET. Limiting
 * POST to these keeps the proxy from being a general write channel on our
 * Blockfrost project for whatever else Blockfrost accepts now or later.
 */
const POST_ENDPOINTS = new Set([
  "tx/submit",
  "utils/txs/evaluate",
  "utils/txs/evaluate/utxos",
]);

/**
 * Upper bound on a forwarded request body. A Cardano transaction is at most
 * 16 KiB (32 KiB as hex); evaluate/utxos adds the extra UTxO set as JSON.
 * 1 MiB leaves ample headroom for both. Body parsing is off for this route,
 * so without this cap the handler buffered any body a caller sent, in full,
 * before forwarding it.
 */
const MAX_PROXY_BODY_BYTES = 1024 * 1024;

class BodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the size limit");
    this.name = "BodyTooLargeError";
  }
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

/**
 * Read the request body, giving up as soon as it passes `maxBytes` rather than
 * after buffering all of it.
 */
async function getRawBody(
  req: NextApiRequest,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    const onData = (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        cleanup();
        // Stop pulling the rest off the socket; the 413 is sent with
        // `Connection: close`, so the unread remainder is dropped with it.
        req.pause();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks, received));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

function sendBodyTooLarge(res: NextApiResponse) {
  res.setHeader("Connection", "close");
  return res.status(413).json({ error: "Request entity too large" });
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
  // Nothing that uses this proxy sends anything but GET and POST. Other
  // methods used to be forwarded to Blockfrost verbatim with our project key.
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const slug = req.query.slug as string[] | undefined;
    if (!slug || slug.length === 0) {
      return res.status(400).json({ error: "Network parameter is required" });
    }

    const network = slug[0]!; // Safe because we checked slug.length > 0
    if (!NETWORKS.has(network)) {
      return res.status(400).json({ error: "network must be mainnet or preprod" });
    }

    const segments = slug.slice(1);
    if (!segments.every((segment) => SEGMENT_RE.test(segment))) {
      return res.status(400).json({ error: "Invalid Blockfrost path" });
    }

    // Construct endpoint - detect CBOR endpoints early
    const endpointPath = segments.join("/");
    const queryString = getQueryString(req.url ?? "");
    const endpoint = endpointPath + queryString;
    const isCBOR = isCBOREndpoint(endpointPath);

    if (req.method === "POST" && !POST_ENDPOINTS.has(endpointPath)) {
      res.setHeader("Allow", "GET, OPTIONS");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const networkConfig = getNetworkConfig(network);
    if (!networkConfig || !networkConfig.key) {
      return res.status(500).json({
        error: `Missing Blockfrost API key for network: ${network}`,
      });
    }

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
    
    if (req.method === "POST") {
      // Refuse an oversized body up front when the client declares it.
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > MAX_PROXY_BODY_BYTES) {
        return sendBodyTooLarge(res);
      }

      if (isCBOR) {
        // For CBOR endpoints, read raw body and convert to buffer
        try {
          const rawBody = await getRawBody(req, MAX_PROXY_BODY_BYTES);
          const buffer = convertToBuffer(rawBody);
          // Convert Buffer to Uint8Array for fetch API compatibility
          requestBody = new Uint8Array(buffer);
        } catch (error) {
          if (error instanceof BodyTooLargeError) {
            return sendBodyTooLarge(res);
          }
          console.error("Error reading raw body for CBOR endpoint:", error);
          return res.status(400).json({
            error: "Failed to read request body for CBOR endpoint",
          });
        }
      } else {
        // For JSON endpoints, parse the body as text
        try {
          const rawBody = await getRawBody(req, MAX_PROXY_BODY_BYTES);
          const bodyText = rawBody.toString("utf-8");
          if (bodyText) {
            requestBody = bodyText;
          }
        } catch (error) {
          if (error instanceof BodyTooLargeError) {
            return sendBodyTooLarge(res);
          }
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
