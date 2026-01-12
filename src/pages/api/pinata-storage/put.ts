import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";

interface PinataResponse {
  data: {
    id: string;
    name: string;
    cid: string;
    size: number;
    number_of_files: number;
    mime_type: string;
    group_id: string | null;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const pathname = req.body.pathname as string;
    const value = req.body.value as string;

    if (!pathname || !value) {
      return res.status(400).json({ error: "pathname and value are required" });
    }

    // Extract just the filename from pathname (remove folder structure)
    const filename = pathname.split("/").pop() || pathname;

    // Create FormData for Pinata upload
    // In Node.js 18+, FormData is available globally
    const formData = new FormData();
    const buffer = Buffer.from(value, "utf-8");
    const blob = new Blob([buffer], { type: "application/ld+json" });
    formData.append("file", blob, filename);
    formData.append("network", "public");

    // Upload to Pinata
    const pinataResponse = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PINATA_JWT}`,
      },
      body: formData,
    });

    if (!pinataResponse.ok) {
      const errorText = await pinataResponse.text();
      console.error("Pinata upload error:", errorText);
      return res.status(pinataResponse.status).json({ 
        error: "Pinata upload failed", 
        details: errorText 
      });
    }

    const pinataData = (await pinataResponse.json()) as PinataResponse;
    
    // Construct IPFS gateway URL using public IPFS gateway
    const ipfsUrl = `https://ipfs.io/ipfs/${pinataData.data.cid}`;

    res.status(200).json({ 
      url: ipfsUrl,
      cid: pinataData.data.cid,
      id: pinataData.data.id,
    });
  } catch (error) {
    console.error("Error uploading to Pinata:", error);
    res.status(500).json({ 
      error: "Internal server error", 
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

