import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { sign } from "jsonwebtoken";
import {
  checkSignature,
  DataSignature,
  deserializeAddress,
} from "@meshsdk/core";
import { cors } from "@/lib/cors";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    const { address } = req.query;
    if (typeof address !== "string") {
      return res.status(400).json({ error: "Invalid address" });
    }
    // Verify that the address exists in the User table
    const user = await db.user.findUnique({ where: { address } });
    if (!user) {
      return res.status(404).json({ error: "Address not found" });
    }

    // Check if a nonce already exists for this address in the database
    const existing = await db.nonce.findFirst({ where: { address } });
    if (existing) {
      return res.status(200).json({ nonce: existing.value });
    }

    const nonce = randomBytes(16).toString("hex");
    await db.nonce.create({
      data: {
        address,
        value: nonce,
      },
    });
    return res.status(200).json({ nonce });
  }

  if (req.method === "POST") {
    const { address, signature, key } = req.body;
    if (
      typeof address !== "string" ||
      typeof signature !== "string" ||
      typeof key !== "string"
    ) {
      return res
        .status(400)
        .json({ error: "Missing address, signature or key." });
    }

    // Fetch the nonce from the database
    const nonceEntry = await db.nonce.findFirst({ where: { address } });
    if (!nonceEntry) {
      return res
        .status(400)
        .json({ error: "No nonce issued for this address" });
    }

    const nonce = nonceEntry.value;
    const sig: DataSignature = { signature: signature, key: key };

    const isValid = await checkSignature(nonce, sig, address);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Delete the nonce from the database after verification
    await db.nonce.delete({ where: { id: nonceEntry.id } });

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not defined in environment variables");
    }
    const token = sign({ address }, jwtSecret, { expiresIn: "1h" });

    return res.status(200).json({ token });
  }

  res.status(405).end();
}
