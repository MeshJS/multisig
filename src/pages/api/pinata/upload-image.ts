import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";
import formidable from "formidable";
import fs from "fs";

interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
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
    if (!env.PINATA_API_KEY || !env.PINATA_SECRET_API_KEY || !env.NEXT_PUBLIC_PINATA_GATEWAY_URL) {
      return res.status(500).json({ error: "Pinata configuration not available" });
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

    const pinataResponse = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: {
        pinata_api_key: env.PINATA_API_KEY,
        pinata_secret_api_key: env.PINATA_SECRET_API_KEY,
      },
      body: formData,
    });

    if (!pinataResponse.ok) {
      const errorText = await pinataResponse.text();
      console.error("Pinata upload failed:", errorText);
      return res.status(500).json({ error: "Failed to upload to Pinata" });
    }

    const pinataData = (await pinataResponse.json()) as PinataResponse;
    const url = `${env.NEXT_PUBLIC_PINATA_GATEWAY_URL}/ipfs/${pinataData.IpfsHash}`;

    // Clean up temporary file
    fs.unlinkSync(file.filepath);

    res.status(200).json({
      url,
      hash: pinataData.IpfsHash,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
