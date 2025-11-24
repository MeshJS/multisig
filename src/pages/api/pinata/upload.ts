import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";

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

    if (!env.PINATA_API_KEY || !env.PINATA_SECRET_API_KEY || !env.NEXT_PUBLIC_PINATA_GATEWAY_URL) {
      return res.status(500).json({ error: "Pinata configuration not available" });
    }

    // Upload to Pinata
    const formData = new FormData();
    const blob = new Blob([content], { type: "application/json" });
    formData.append("file", blob, filename);

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

    res.status(200).json({
      url,
      hash: pinataData.IpfsHash,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
