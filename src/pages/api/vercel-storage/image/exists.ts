import type { NextApiRequest, NextApiResponse } from "next";
import { list } from "@vercel/blob";
import { env } from "@/env";

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

  // Construct the directory path where files are stored.
  const directory = `img/${shortHash}/`;

  try {
    // List only blobs under the specified directory
    const response = await list({ prefix: directory, token: env.BLOB_READ_WRITE_TOKEN });
    if (response.blobs && response.blobs.length > 0) {
      const blob = response.blobs[0];
      if (blob && blob.downloadUrl) {
        const urlString: string = blob.downloadUrl;
        let cleanUrl: string = urlString; // initialize with a fallback value
        try {
          const urlObj = new URL(urlString);
          urlObj.search = "";
          cleanUrl = urlObj.toString();
        } catch (e) {
          console.error(e);
        }
        return res.status(200).json({ exists: true, url: cleanUrl });
      }
    }
    return res.status(200).json({ exists: false });
  } catch (error) {
    console.error("Error listing files:", error);
    return res.status(500).json({ error: "Error listing files", details: error });
  }
}