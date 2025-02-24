import type { NextApiRequest, NextApiResponse } from "next";
import { put } from "@vercel/blob";
import fs from "fs";
import { env } from "@/env";
import formidable, { Fields, Files, File } from "formidable";

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
    const parseForm = (): Promise<{ fields: Fields; files: Files }> =>
      new Promise((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) {
            return reject(new Error(err instanceof Error ? err.message : "Form parsing error"));
          }
          resolve({ fields, files });
        });
      });

    const { fields, files } = await parseForm();

    if (!files.file || !files.file[0]) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const file: File = Array.isArray(files.file) ? files.file[0] : files.file;
    const fileStream = fs.createReadStream(file.filepath);

    // Validate and retrieve form fields
    const rawShortHash = fields.shortHash;
    if (!rawShortHash || typeof rawShortHash !== "string") {
      return res.status(400).json({ error: "shortHash is required" });
    }
    const shortHash = rawShortHash;

    const rawFilename = fields.filename;
    if (!rawFilename || typeof rawFilename !== "string") {
      return res.status(400).json({ error: "filename is required" });
    }
    const filename = rawFilename;

    // Build the storage path as: img/[shortHash]/filename
    const storagePath = `img/${shortHash}/${filename}`;

    const contentType =
      typeof file.mimetype === "string" ? file.mimetype : "application/octet-stream";

    const response = await put(storagePath, fileStream, {
      access: "public",
      token: env.BLOB_READ_WRITE_TOKEN,
      contentType,
    });

    return res.status(200).json({ url: response.url });
  } catch (err) {
    console.error("File upload error:", err);
    return res.status(500).json({ error: "Internal Server Error", details: err });
  }
}