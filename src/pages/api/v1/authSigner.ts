import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import jwt from "jsonwebtoken";

const { sign } = jwt;
import {
  checkSignature,
  DataSignature,
} from "@meshsdk/core";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { audit } from "@/lib/observability/audit";
import { getClientIP } from "@/lib/security/rateLimit";
import { normalizeAddressToBech32 } from "@/utils/addressCompatibility";

/**
 * POST /api/v1/authSigner — exchange a signed nonce for a v1 bearer token.
 *
 * Status contract (pinned by src/__tests__/authSignerApi.test.ts):
 *  400 bad input or no nonce issued, 401 a signature that does not verify —
 *  including one checkSignature THROWS on (malformed COSE key/signature,
 *  non-bech32 address) — or a nonce that was already spent, 200 a token.
 *  500 is left for genuine server faults (DB down, JWT_SECRET missing).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/authSigner", maxRequests: 20 })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).end();
  }

  if (!enforceBodySize(req, res, 64 * 1024)) {
    return;
  }
  const { address: rawAddress, signature, key } = req.body ?? {};
  if (
    typeof rawAddress !== "string" ||
    typeof signature !== "string" ||
    typeof key !== "string"
  ) {
    return res
      .status(400)
      .json({ error: "Missing address, signature or key." });
  }

  // Some CIP-30 wallets return hex-encoded address bytes. checkSignature
  // only accepts bech32 and throws on hex, so a hex caller could never sign
  // in. getNonce applies the same normalization, so both ends agree on which
  // row holds the nonce — and the token always carries the bech32 address the
  // rest of v1 compares against.
  const address = normalizeAddressToBech32(rawAddress);

  try {
    // Checked before any DB work so a misconfigured deploy fails without
    // spending the caller's nonce.
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not defined in environment variables");
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

    // checkSignature throws, rather than returning false, on input it cannot
    // parse. That is still just a bad signature from the caller's side, so
    // it gets the same 401 (and the same audit row) as one that fails to verify.
    let isValid = false;
    try {
      isValid = await checkSignature(nonce, sig, address);
    } catch (verifyError) {
      console.warn(
        "[v1/authSigner] checkSignature threw; treating as invalid signature:",
        verifyError instanceof Error ? verifyError.message : verifyError,
      );
    }

    if (!isValid) {
      void audit(db, {
        actorAddress: address,
        actorType: "user",
        action: "auth.sign_in.invalid_signature",
        ip: getClientIP(req),
        userAgent: req.headers["user-agent"] ?? null,
        outcome: "denied",
        reason: "Invalid signature",
      });
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Consume exactly the nonce that was verified, in one statement. With a
    // plain delete-by-id, two concurrent requests replaying the same signature
    // both passed the check and the loser crashed with a 500; and a getNonce
    // rotation landing between the read and the delete meant a signature over
    // the old value still bought a token. Matching on the value as well makes
    // both cases a clean 401: one signed nonce, at most one token.
    const consumed = await db.nonce.deleteMany({
      where: { id: nonceEntry.id, value: nonce },
    });
    if (consumed.count !== 1) {
      return res
        .status(401)
        .json({ error: "Nonce already used or replaced; request a new one" });
    }

    const botUser = await db.botUser.findUnique({ where: { paymentAddress: address } });
    if (botUser) {
      const token = sign(
        { address: botUser.paymentAddress, botId: botUser.id, type: "bot" as const },
        jwtSecret,
        { expiresIn: "1h" },
      );
      void audit(db, {
        actorAddress: address,
        actorType: "bot",
        action: "auth.sign_in",
        resourceType: "bot",
        resourceId: botUser.id,
        ip: getClientIP(req),
        userAgent: req.headers["user-agent"] ?? null,
        outcome: "success",
      });
      return res.status(200).json({ token });
    }

    const token = sign({ address }, jwtSecret, { expiresIn: "1h" });
    void audit(db, {
      actorAddress: address,
      actorType: "user",
      action: "auth.sign_in",
      ip: getClientIP(req),
      userAgent: req.headers["user-agent"] ?? null,
      outcome: "success",
    });
    return res.status(200).json({ token });
  } catch (error) {
    // Bad input is 400 and a failed or unparseable signature is 401, both
    // above, so reaching here means something server-side actually broke.
    console.error("[v1/authSigner] Unexpected error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
