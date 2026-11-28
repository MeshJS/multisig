import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { type DataSignature } from "@meshsdk/core";
import { checkSignature } from "@meshsdk/core-cst";
import { applyRateLimit, applyBotRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { assertBotWalletAccess, BotAccessError, botHasScope } from "@/lib/auth/botAccess";
import { enqueueSignatureRequiredNotifications } from "@/lib/notifications/center";
import { summarizeSignableSignatureContext } from "@/lib/notifications/signatureContext";

// Whole bytes only: CBOR is parsed from hex, so an odd digit count can never decode.
const HEX_RE = /^(?:[0-9a-f]{2})+$/i;
export const MAX_CALLBACK_URL_LENGTH = 2048;

export type SubmitDatumBody = {
  walletId: string;
  signature: string;
  key: string;
  address: string;
  datum: string;
  callbackUrl: string | null;
  description: string;
};

/**
 * Validate the request body before anything touches it.
 *
 * WHY: every field used to be checked only for truthiness. A missing `key`
 * slipped through (the check tested `signature` twice), and a non-string or
 * non-hex value reached checkSignature or Prisma, which throw, so the caller
 * got a 500 for its own malformed request. `callbackUrl` was rejected when
 * absent, with a message naming the wrong field, although the OpenAPI spec
 * lists it as optional and the row stores null for it; it is optional again,
 * and when given it must be an http(s) URL, since it is stored as a URL to
 * call back.
 */
export function parseSubmitDatumBody(
  input: unknown,
): { ok: true; body: SubmitDatumBody } | { ok: false; error: string } {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;

  if (!nonEmpty(raw.walletId)) {
    return { ok: false, error: "walletId is required" };
  }
  if (!nonEmpty(raw.signature) || !HEX_RE.test(raw.signature)) {
    return { ok: false, error: "signature is required and must be hex" };
  }
  if (!nonEmpty(raw.key) || !HEX_RE.test(raw.key)) {
    return { ok: false, error: "key is required and must be hex" };
  }
  if (!nonEmpty(raw.address)) {
    return { ok: false, error: "address is required" };
  }
  if (!nonEmpty(raw.datum)) {
    return { ok: false, error: "datum is required and must be a string" };
  }
  if (raw.description != null && typeof raw.description !== "string") {
    return { ok: false, error: "description must be a string" };
  }

  let callbackUrl: string | null = null;
  if (raw.callbackUrl !== undefined && raw.callbackUrl !== null && raw.callbackUrl !== "") {
    if (
      typeof raw.callbackUrl !== "string" ||
      raw.callbackUrl.length > MAX_CALLBACK_URL_LENGTH ||
      !isHttpUrl(raw.callbackUrl)
    ) {
      return {
        ok: false,
        error: `callbackUrl must be an http(s) URL of at most ${MAX_CALLBACK_URL_LENGTH} characters`,
      };
    }
    callbackUrl = raw.callbackUrl;
  }

  return {
    ok: true,
    body: {
      walletId: raw.walletId,
      signature: raw.signature,
      key: raw.key,
      address: raw.address,
      datum: raw.datum,
      callbackUrl,
      description: typeof raw.description === "string" ? raw.description : "External Tx",
    },
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);
  
  if (!applyRateLimit(req, res, { keySuffix: "v1/submitDatum" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!enforceBodySize(req, res, 128 * 1024)) {
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized - Missing or malformed Authorization header (expected: Bearer <token>)" });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  if (isBotJwt(payload) && !applyBotRateLimit(req, res, payload.botId)) {
    return;
  }

  // Scope gate before body validation: a scope-less bot gets a clean 403
  // instead of misleading 400s from payload shape checks.
  if (isBotJwt(payload) && !(await botHasScope(db, payload.botId, "multisig:sign"))) {
    return res.status(403).json({ error: "Insufficient scope: multisig:sign required" });
  }

  const session = {
    user: { id: payload.address },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  const parsed = parseSubmitDatumBody(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  const { walletId, signature, key, address, datum, callbackUrl, description } =
    parsed.body;

  if (session.user.id !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }

  const sig: DataSignature = { signature, key };

  // checkSignature throws (rather than returning false) on a signature or key
  // that is not a decodable COSE structure. That is the caller's malformed
  // input, not a server fault, so it is a 400 and not an unhandled 500.
  let isValid: boolean;
  try {
    isValid = await checkSignature(datum, sig, address);
  } catch (error) {
    // Logged so that a genuine library fault (not a bad input) stays visible.
    console.warn("submitDatum: checkSignature threw", error);
    return res
      .status(400)
      .json({ error: "signature and key must be a COSE_Sign1 signature and COSE_Key" });
  }

  if (!isValid) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  let wallet: { id: string } | null;
  if (isBotJwt(payload)) {
    try {
      const result = await assertBotWalletAccess(db, walletId, payload, true);
      wallet = result.wallet;
    } catch (err) {
      if (err instanceof BotAccessError) {
        return res.status(err.status).json({ error: err.message });
      }
      return res.status(403).json({ error: "Not authorized for this wallet" });
    }
  } else {
    const w = await db.wallet.findUnique({ where: { id: walletId } });
    const signers = w?.signersAddresses ?? [];
    const isSigner = Array.isArray(signers) && signers.includes(address);
    if (!w || !isSigner) {
      return res.status(403).json({ error: "Not authorized for this wallet" });
    }
    wallet = w;
  }

  try {
    const newSignable = await db.signable.create({
      data: {
        walletId,
        payload: datum,
        signatures: [JSON.stringify({ signature: sig.signature, key: sig.key })],
        signedAddresses: [address],
        rejectedAddresses: [],
        description,
        callbackUrl,
        remoteOrigin: req.headers.origin || null,
        state: 0,
      },
    });

    try {
      const walletRow = await db.wallet.findUnique({
        where: { id: walletId },
        select: {
          id: true,
          name: true,
          signersAddresses: true,
          numRequiredSigners: true,
          type: true,
        },
      });
      if (walletRow) {
        await enqueueSignatureRequiredNotifications(db, {
          wallet: walletRow,
          resourceType: "signable",
          resourceId: newSignable.id,
          signedAddresses: newSignable.signedAddresses,
          rejectedAddresses: newSignable.rejectedAddresses,
          creatorAddress: address,
          description: newSignable.description,
          signatureContext: summarizeSignableSignatureContext({
            method: newSignable.method,
            description: newSignable.description,
          }),
        });
      }
    } catch (notificationError) {
      console.error("Failed to enqueue signable notifications", notificationError);
    }

    res.status(201).json(newSignable);
  } catch (error) {
    console.error("Error creating signable:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
