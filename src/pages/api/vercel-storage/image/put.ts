import type { NextApiRequest, NextApiResponse } from "next";
import { put } from "@vercel/blob";
import fs from "fs";
import { env } from "@/env";
import formidable from "formidable";

export const config = {
  api: {
    bodyParser: false, // Required for file uploads
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const form = formidable({ multiples: false });
    const parseForm = () =>
      new Promise<{ fields: any; files: any }>((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err);
          resolve({ fields, files });
        });
      });

    const { fields, files } = await parseForm();

    if (!files.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const fileStream = fs.createReadStream(file.filepath);

    // Retrieve shortHash and fixed filename from the form fields
    const shortHash = fields.shortHash;
    if (!shortHash) {
      return res.status(400).json({ error: "shortHash is required" });
    }
    const filename = fields.filename;
    if (!filename) {
      return res.status(400).json({ error: "filename is required" });
    }

    // Build the storage path as: img/[shortHash]/filename
    const storagePath = `img/${shortHash}/${filename}`;

    const response = await put(storagePath, fileStream, {
      access: "public",
      token: env.BLOB_READ_WRITE_TOKEN,
      contentType: file.mimetype || "application/octet-stream",
    });

    res.status(200).json({ url: response.url });
  } catch (err) {
    console.error("File upload error:", err);
    res.status(500).json({ error: "Internal Server Error", details: err });
  }
}