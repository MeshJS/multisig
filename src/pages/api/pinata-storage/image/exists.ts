import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";

interface PinataListResponse {
  data: {
    files: Array<{
      id: string;
      name: string;
      cid: string;
      size: number;
      mime_type: string;
      created_at: string;
    }>;
    total_count: number;
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { shortHash } = req.query;
  if (!shortHash || typeof shortHash !== "string") {
    res.status(400).json({ error: "shortHash is required" });
    return;
  }

  try {
    // Pinata doesn't have a direct "exists" API, so we'll search for files
    // Since we can't search by hash directly, we'll need to list files
    // For now, we'll use a workaround: try to get file info by attempting to list
    // In a production system, you might want to maintain a mapping of shortHash -> CID
    
    // Note: Pinata's list API requires pagination and doesn't support searching by hash
    // For this implementation, we'll return false and let the client handle upload
    // In a real scenario, you might want to:
    // 1. Store shortHash -> CID mappings in a database
    // 2. Use Pinata's metadata search if available
    // 3. Or skip the existence check and rely on IPFS deduplication
    
    // For now, return false to allow upload (IPFS will handle deduplication via CID)
    return res.status(200).json({ exists: false });
  } catch (error) {
    console.error("Error checking file existence:", error);
    return res.status(500).json({ 
      error: "Error checking file existence", 
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

