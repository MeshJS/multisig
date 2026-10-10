import type { NextApiRequest, NextApiResponse } from "next";

import { db } from "@/server/db";
import { getWalletSessionFromReq } from "@/lib/auth/walletSession";
import { isAcceptableRedirectUri } from "@/lib/oauth/redirects";
import { AUTHORIZATION_CODE_TTL_SECONDS, issuerOrigin } from "@/lib/oauth/config";
import { decodeAuthorizationRequest } from "@/lib/oauth/requests";
import { generateOpaqueToken, hashToken } from "@/lib/oauth/accessToken";
import { applyRateLimit, enforceBodySize } from "@/lib/security/requestGuards";

/**
 * POST /api/oauth/decision — record the user's consent and issue an authorization code.
 *
 * The pending request arrives as a signed handle minted by `/api/oauth/authorize`,
 * so the client, scopes and redirect URI cannot be tampered with between the two
 * steps. The user's identity comes from the wallet-session cookie.
 *
 * Both are required: the handle says *what* is being approved, the cookie says
 * *who* is approving. Neither alone is consent.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    return await decide(req, res);
  } catch (error) {
    console.error("[api/oauth/decision] failed:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: "server_error",
        error_description: "Could not record the decision. Please try again.",
      });
    }
    return undefined;
  }
}

async function decide(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!applyRateLimit(req, res, { keySuffix: "oauth/decision", maxRequests: 30 })) {
    return;
  }
  if (!enforceBodySize(req, res, 8 * 1024)) {
    return;
  }

  const handle = typeof req.body?.request === "string" ? req.body.request : null;
  const approved = req.body?.approved === true;
  const chosenScopes = Array.isArray(req.body?.scopes)
    ? (req.body.scopes as unknown[]).filter(
        (s): s is string => typeof s === "string",
      )
    : null;
  if (!handle) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing request handle" });
  }

  const request = decodeAuthorizationRequest(handle);
  if (!request) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "The authorization request is invalid or has expired. Start again from the client.",
    });
  }

  // Last gate before a URL is handed to the browser for navigation. The handle
  // is signed by us and the value was validated at registration and again at
  // /authorize, but this is the actual sink — anything that is not https or
  // loopback http (a `javascript:` URI, say) must never reach window.location.
  if (!isAcceptableRedirectUri(request.redirectUri)) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "redirect_uri scheme is not permitted",
    });
  }

  const redirect = new URL(request.redirectUri);
  if (request.state) redirect.searchParams.set("state", request.state);
  // RFC 9207 — lets the client confirm which AS answered.
  redirect.searchParams.set("iss", issuerOrigin(req));

  if (!approved) {
    redirect.searchParams.set("error", "access_denied");
    redirect.searchParams.set("error_description", "The user denied the request");
    return res.status(200).json({ redirectTo: redirect.toString() });
  }

  // Identity comes from the HttpOnly wallet-session cookie, never from the
  // request body — a body-supplied address would let anyone mint a grant for
  // someone else's wallets.
  const session = getWalletSessionFromReq(req);
  const addresses = session?.wallets?.filter((a) => typeof a === "string") ?? [];
  const subject = session?.primaryWallet ?? addresses[0] ?? null;

  if (!subject || addresses.length === 0) {
    return res.status(401).json({
      error: "access_denied",
      error_description: "Connect and sign in with a wallet before approving.",
    });
  }

  // The user may hand over less than the client asked for, never more. The
  // signed handle is the ceiling; the body only ever narrows it, so a tampered
  // `scopes` array cannot reach past what /authorize already validated.
  // Omitting the field grants everything requested, which is what a client
  // driving this endpoint directly (and every pre-checkbox consent) expects.
  const grantedScopes = chosenScopes
    ? request.scopes.filter((scope) => chosenScopes.includes(scope))
    : request.scopes;

  // An approval that grants nothing is not an approval. It would mint a token
  // that authenticates and exposes no tools — indistinguishable, from the
  // client's side, from the server being broken. Denying says what happened.
  if (grantedScopes.length === 0) {
    return res.status(400).json({
      error: "invalid_scope",
      error_description:
        "Select at least one permission, or cancel to deny the request.",
    });
  }

  const code = generateOpaqueToken();

  await db.$transaction(async (tx) => {
    await tx.oAuthAuthorizationCode.create({
      data: {
        codeHash: hashToken(code),
        clientId: request.clientId,
        subjectAddress: subject,
        grantedAddresses: addresses,
        scopes: grantedScopes,
        resource: request.resource,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
      },
    });

    // One durable grant row per (user, client) so repeat consents update rather
    // than accumulate, and the user has one thing to revoke later.
    await tx.oAuthGrant.upsert({
      where: {
        subjectAddress_clientId: {
          subjectAddress: subject,
          clientId: request.clientId,
        },
      },
      update: { scopes: grantedScopes, grantedAddresses: addresses },
      create: {
        subjectAddress: subject,
        clientId: request.clientId,
        scopes: grantedScopes,
        grantedAddresses: addresses,
      },
    });
  });

  redirect.searchParams.set("code", code);
  return res.status(200).json({ redirectTo: redirect.toString() });
}
