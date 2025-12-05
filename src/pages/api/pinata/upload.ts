import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";

interface PinataV3Response {
  id: string;
  cid: string;
  name: string;
  size: number;
  number_of_files: number;
  mime_type: string;
  group_id: string | null;
}

interface UploadResponse {
  url: string;
  hash: string;
}

interface ErrorResponse {
  error: string;
  details?: string;
  pinataError?: unknown;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UploadResponse | ErrorResponse>,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { content, filename } = req.body;

    if (!content || !filename) {
      return res.status(400).json({ error: "Content and filename are required" });
    }

    // Check for Pinata JWT (v3) or API keys (v1) - prefer v3
    if (!env.PINATA_JWT && (!env.PINATA_API_KEY || !env.PINATA_SECRET_API_KEY)) {
      return res.status(503).json({ error: "Pinata configuration not available" });
    }

    // Use Pinata v3 API with JWT if available, otherwise fall back to v1
    const formData = new FormData();
    const contentBuffer = Buffer.from(content, "utf-8");
    const blob = new Blob([contentBuffer], { type: "application/json" });
    formData.append("file", blob, filename);

    let pinataResponse: Response;
    
    if (env.PINATA_JWT) {
      // Pinata v3 API
      formData.append("network", "public"); // Optional: "public" or "private"

      pinataResponse = await fetch("https://uploads.pinata.cloud/v3/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.PINATA_JWT}`,
          // Don't set Content-Type header - fetch will set it with boundary for multipart/form-data
        },
        body: formData,
      });
    } else {
      // Fallback to v1 API
      pinataResponse = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: {
          pinata_api_key: env.PINATA_API_KEY!,
          pinata_secret_api_key: env.PINATA_SECRET_API_KEY!,
        },
        body: formData,
      });
    }

    if (!pinataResponse.ok) {
      let errorMessage = "Failed to upload to Pinata";
      let pinataError: unknown = null;
      
      try {
        const errorData = await pinataResponse.json();
        pinataError = errorData;
        // Pinata error format: { error: { message: "...", reason: "...", details: "..." } } or { error: "..." }
        const reason = errorData.error?.reason || errorData.error?.details || "";
        const details = errorData.error?.details || "";
        
        // Provide user-friendly error messages for common issues
        if (reason === "NO_SCOPES_FOUND") {
          errorMessage = env.PINATA_JWT 
            ? "Pinata JWT token missing required permissions. Please check your JWT token permissions."
            : "Pinata API key missing required permissions. Please enable 'pinFileToIPFS' scope in your Pinata dashboard.";
        } else if (pinataResponse.status === 401) {
          errorMessage = env.PINATA_JWT
            ? "Invalid Pinata JWT token. Please check your JWT token."
            : "Invalid Pinata API credentials. Please check your API key and secret.";
        } else if (pinataResponse.status === 403) {
          errorMessage = `Pinata permission denied: ${details || reason || "Check API permissions"}`;
        } else if (pinataResponse.status === 429) {
          errorMessage = "Pinata rate limit exceeded. Please wait a moment and try again.";
        } else {
          errorMessage = 
            errorData.error?.message || 
            details ||
            reason ||
            errorData.error || 
            errorData.message ||
            errorMessage;
        }
          
        console.error("Pinata upload failed:", {
          status: pinataResponse.status,
          statusText: pinataResponse.statusText,
          error: errorData,
          authType: env.PINATA_JWT ? "JWT" : "API_KEY",
          authConfigured: env.PINATA_JWT ? !!env.PINATA_JWT : !!(env.PINATA_API_KEY && env.PINATA_SECRET_API_KEY),
        });
      } catch (e) {
        const errorText = await pinataResponse.text();
        console.error("Pinata upload failed (non-JSON response):", {
          status: pinataResponse.status,
          statusText: pinataResponse.statusText,
          errorText,
        });
        errorMessage = errorText || errorMessage;
      }
      
      // Return more specific error information
      const statusCode = pinataResponse.status >= 400 && pinataResponse.status < 500 
        ? pinataResponse.status 
        : 500;
        
      return res.status(statusCode).json({ 
        error: errorMessage,
        details: pinataResponse.statusText,
        pinataError: pinataError,
      });
    }

    // Parse successful response
    const rawResponse = await pinataResponse.json();
    
    console.log("Pinata upload response (raw):", JSON.stringify(rawResponse, null, 2));

    // Extract CID/IPFS hash from response
    // v3 API response structure per docs: { id, cid, name, size, number_of_files, mime_type, group_id }
    // v1 API response structure: { IpfsHash, PinSize, Timestamp }
    let ipfsHash: string | undefined;
    
    if (env.PINATA_JWT) {
      // v3 API - response may be wrapped in 'data' field
      const response = rawResponse as any;
      const data = response.data || response;
      
      // Extract CID from the data object
      ipfsHash = data.cid 
        || data.CID
        || data.ipfsHash
        || data.IpfsHash
        || data.hash;
    } else {
      // v1 API
      ipfsHash = (rawResponse as { IpfsHash: string }).IpfsHash;
    }

    if (!ipfsHash) {
      console.error("Failed to extract IPFS hash from response. Full response:", JSON.stringify(rawResponse, null, 2));
      console.error("Response keys:", Object.keys(rawResponse));
      return res.status(500).json({ 
        error: "Failed to extract IPFS hash from Pinata response",
        details: "Response structure may have changed. Check server logs for full response.",
        responseStructure: Object.keys(rawResponse),
        rawResponse: rawResponse,
      });
    }
    
    // Always use public IPFS gateway for links
    const url = `https://ipfs.io/ipfs/${ipfsHash}`;

    res.status(200).json({
      url,
      hash: ipfsHash,
    });
  } catch (error) {
    console.error("Upload error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ 
      error: "Internal server error",
      details: errorMessage,
    });
  }
}
