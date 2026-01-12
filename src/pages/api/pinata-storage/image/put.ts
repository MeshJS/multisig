import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";
import formidable, { Fields, Files, File } from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false, // Required for file uploads
  },
};

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
    const form = formidable({ multiples: false });
    const parseForm = (): Promise<{ fields: Fields; files: Files }> =>
      new Promise((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) {
            return reject(
              new Error(
                err instanceof Error ? err.message : "Form parsing error",
              ),
            );
          }
          resolve({ fields, files });
        });
      });

    const { fields, files } = await parseForm();

    if (!files.file || !files.file[0]) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const file: File = Array.isArray(files.file) ? files.file[0] : files.file;
    
    // Validate file size (1MB = 1,048,576 bytes)
    const MAX_FILE_SIZE = 1048576;
    const fileSize = file.size;
    if (fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({ 
        error: `File size exceeds 1MB limit. File size: ${(fileSize / 1024 / 1024).toFixed(2)}MB` 
      });
    }
    
    // Validate and retrieve form fields
    const rawShortHash = Array.isArray(fields.shortHash)
      ? fields.shortHash[0]
      : fields.shortHash;
      
    if (!rawShortHash || typeof rawShortHash !== "string") {
      return res.status(400).json({ error: "shortHash is required" });
    }
    const shortHash = rawShortHash;

    const rawFilename = Array.isArray(fields.filename)
      ? fields.filename[0]
      : fields.filename;
    if (!rawFilename || typeof rawFilename !== "string") {
      return res.status(400).json({ error: "filename is required" });
    }
    const filename = rawFilename;

    // Read file as buffer
    const fileBuffer = fs.readFileSync(file.filepath);
    const contentType =
      typeof file.mimetype === "string"
        ? file.mimetype
        : "application/octet-stream";

    // Create Blob for Pinata upload
    const fileBlob = new Blob([fileBuffer], { type: contentType });

    // Create FormData for Pinata upload
    const formData = new FormData();
    formData.append("file", fileBlob, filename);
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

    return res.status(200).json({ 
      url: ipfsUrl,
      cid: pinataData.data.cid,
      id: pinataData.data.id,
    });
  } catch (err) {
    console.error("File upload error:", err);
    return res
      .status(500)
      .json({ 
        error: "Internal Server Error", 
        details: err instanceof Error ? err.message : String(err)
      });
  }
}

