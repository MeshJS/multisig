import type { NextApiRequest, NextApiResponse } from "next";
import { PinataSDK } from "pinata";
import { createHash } from "crypto";
import { env } from "@/env";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { pathname, value, userAddress, walletId } = req.body;

    if (!value || typeof value !== "string") {
      return res.status(400).json({ error: "value is required and must be a string" });
    }

    // Compute SHA-256 hash of the content
    const contentHash = createHash("sha256").update(value).digest("hex");

    // Step 1: Check database first for duplicate
    const existingHash = await db.ipfsHash.findFirst({
      where: {
        contentHash,
      },
    });

    if (existingHash) {
      // Duplicate found in database, return existing CID
      return res.status(200).json({ url: `ipfs://${existingHash.ipfsCid}` });
    }

    // Step 2: Initialize Pinata SDK
    const pinata = new PinataSDK({
      pinataJwt: env.PINATA_JWT,
    });

    // Step 3: Check Pinata for existing content using metadata query
    try {
      // Query Pinata for existing pins with this content hash
      const pinataFiles = await pinata.files
        .list()
        .metadata({ contentHash })
        .then();

      if (pinataFiles.files && pinataFiles.files.length > 0) {
        // Found in Pinata, get the CID from the first match
        const existingPin = pinataFiles.files[0];
        const existingCid = existingPin.cid;

        if (existingCid && existingCid !== "pending") {
          // Store mapping in database for future lookups
          await db.ipfsHash.create({
            data: {
              contentHash,
              ipfsCid: existingCid,
              userAddress: userAddress || null,
              walletId: walletId || null,
              pathname: pathname || null,
            },
          });

          return res.status(200).json({ url: `ipfs://${existingCid}` });
        }
      }
    } catch (pinataQueryError) {
      // If query fails, continue to upload (might be a new account with no pins)
      console.warn("Pinata query error (continuing to upload):", pinataQueryError);
    }

    // Step 4: Upload new content to Pinata
    // Parse the value as JSON if possible, otherwise use as string
    let jsonContent;
    try {
      jsonContent = JSON.parse(value);
    } catch {
      // If not valid JSON, wrap it in an object
      jsonContent = { content: value };
    }

    const pinataOptions = {
      metadata: {
        name: pathname || "ipfs-upload",
        keyvalues: {
          contentHash,
        },
      },
    };

    const uploadResult = await pinata.upload.json(jsonContent, pinataOptions);
    const ipfsCid = uploadResult.cid;

    if (!ipfsCid) {
      throw new Error("Failed to get IPFS CID from Pinata response");
    }

    // Step 5: Store mapping in database
    await db.ipfsHash.create({
      data: {
        contentHash,
        ipfsCid,
        userAddress: userAddress || null,
        walletId: walletId || null,
        pathname: pathname || null,
      },
    });

    return res.status(200).json({ url: `ipfs://${ipfsCid}` });
  } catch (error) {
    console.error("IPFS upload error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

