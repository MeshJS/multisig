import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { DataSignature } from "@meshsdk/core";
import { checkSignature } from "@meshsdk/core-cst";
import {
  getWalletSessionFromReq,
  setWalletSessionCookie,
  type WalletSessionPayload,
} from "@/lib/auth/walletSession";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { address, signature, key } = req.body ?? {};
    if (
      typeof address !== "string" ||
      typeof signature !== "string" ||
      typeof key !== "string"
    ) {
      return res.status(400).json({ error: "Missing address, signature or key." });
    }

    // Fetch the nonce from the database (same table used by /api/v1/getNonce)
    const nonceEntry = await db.nonce.findFirst({ where: { address } });
    if (!nonceEntry) {
      return res.status(400).json({ error: "No nonce issued for this address" });
    }

    const nonce = nonceEntry.value;
    const sig: DataSignature = { signature, key };

    const isValid = await checkSignature(nonce, sig, address);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Delete the nonce from the database after verification
    await db.nonce.delete({ where: { id: nonceEntry.id } });

    // Merge with existing wallet session
    const existing = getWalletSessionFromReq(req) ?? { wallets: [] };
    const wallets = new Set(existing.wallets ?? []);
    wallets.add(address);

    const payload: WalletSessionPayload = {
      wallets: Array.from(wallets),
      // Always treat the most recently authorized address as primary so the
      // active wallet matches the last wallet that signed a nonce.
      primaryWallet: address,
    };

    setWalletSessionCookie(res, payload);

    return res.status(200).json({
      ok: true,
      wallets: payload.wallets,
      primaryWallet: payload.primaryWallet,
    });
  } catch (error) {
    console.error("[api/auth/wallet-session] Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}


