import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";
import formidable from "formidable";
import fs from "fs";

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
}

// Disable Next.js body parsing for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UploadResponse | ErrorResponse>,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Check for Pinata JWT (v3) or API keys (v1) - prefer v3
    if (!env.PINATA_JWT && (!env.PINATA_API_KEY || !env.PINATA_SECRET_API_KEY)) {
      return res.status(503).json({ error: "Pinata configuration not available" });
    }

    // Parse the multipart form data
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
    });

    const [fields, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Read the file
    const fileBuffer = fs.readFileSync(file.filepath);
    
    // Upload to Pinata
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: file.mimetype || "application/octet-stream" });
    formData.append("file", blob, file.originalFilename || "image");

    let pinataResponse: Response;
    
    if (env.PINATA_JWT) {
      // Pinata v3 API
      formData.append("network", "public");
      pinataResponse = await fetch("https://uploads.pinata.cloud/v3/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.PINATA_JWT}`,
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
      try {
        const errorData = await pinataResponse.json();
        errorMessage = errorData.error?.message || errorData.error || errorMessage;
      } catch (e) {
        const errorText = await pinataResponse.text();
        errorMessage = errorText || errorMessage;
      }
      console.error("Pinata upload failed:", {
        status: pinataResponse.status,
        error: errorMessage,
      });
      return res.status(pinataResponse.status >= 400 && pinataResponse.status < 500 ? pinataResponse.status : 500).json({ 
        error: errorMessage,
      });
    }

    const rawResponse = await pinataResponse.json();
    
    console.log("Pinata image upload response (raw):", JSON.stringify(rawResponse, null, 2));

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

    // Clean up temporary file
    fs.unlinkSync(file.filepath);

    res.status(200).json({
      url,
      hash: ipfsHash,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
