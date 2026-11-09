import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { DataSignature } from "@meshsdk/core";
import { checkSignature } from "@meshsdk/core-cst";
import { normalizeAddressToBech32 } from "@/utils/addressCompatibility";
import {
  clearWalletSessionCookie,
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

  // Logout: drop the session cookie so the next connect must re-authorize.
  if (req.method === "DELETE") {
    clearWalletSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { address: rawAddress, signature, key } = req.body ?? {};
    if (
      typeof rawAddress !== "string" ||
      typeof signature !== "string" ||
      typeof key !== "string"
    ) {
      return res.status(400).json({ error: "Missing address, signature or key." });
    }

    // Normalize to bech32 up front (defense in depth). Some CIP-30 wallets hand
    // back hex-encoded address bytes; checkSignature() calls Address.fromBech32()
    // internally and THROWS on hex ("Unknown letter ..."), not returns false.
    // The WalletAuthModal client already normalizes, but other callers may not —
    // and an unhandled throw here used to surface as an opaque 500.
    const address = normalizeAddressToBech32(rawAddress);

    // Fetch the nonce from the database (same table used by /api/v1/getNonce)
    const nonceEntry = await db.nonce.findFirst({ where: { address } });
    if (!nonceEntry) {
      return res.status(400).json({ error: "No nonce issued for this address" });
    }

    const nonce = nonceEntry.value;
    const sig: DataSignature = { signature, key };

    // Verify the signature in isolation. checkSignature can THROW (malformed
    // COSE_Sign1 / COSE_Key, non-bech32 address, etc.) as well as return false —
    // treat both as an invalid signature (401), never a 500, and log the
    // underlying reason so genuine failures stay diagnosable.
    let isValid = false;
    try {
      isValid = await checkSignature(nonce, sig, address);
    } catch (verifyError) {
      console.warn(
        "[api/auth/wallet-session] checkSignature threw; treating as invalid signature:",
        verifyError instanceof Error ? verifyError.message : verifyError,
      );
      isValid = false;
    }

    if (!isValid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Consume exactly the verified nonce in one statement, so a replayed
    // signature racing the original gets a 401 instead of crashing the
    // delete, and a nonce rotated by getNonce mid-request is not spent on a
    // signature over its old value. Same rule as /api/v1/authSigner.
    const consumed = await db.nonce.deleteMany({
      where: { id: nonceEntry.id, value: nonce },
    });
    if (consumed.count !== 1) {
      return res
        .status(401)
        .json({ error: "Nonce already used or replaced; request a new one" });
    }

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
    // Reserved for genuinely unexpected failures (e.g. DB errors). Bad input is
    // 400 and a failed/throwing signature check is 401, both handled above — so
    // a 500 here now means something actually went wrong server-side.
    console.error("[api/auth/wallet-session] Unexpected error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
