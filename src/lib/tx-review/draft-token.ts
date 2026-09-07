import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";

import type { TxSpec } from "./spec";

const { sign, verify } = jwt;

/**
 * The draft token — what `transaction_preview` hands back and the ONLY input
 * `transaction_propose` accepts.
 *
 * It binds the transaction the human reviewed to the one that gets created:
 * the normalized spec (base units, canonical ids), the acting address, the
 * wallet, the OAuth client that asked, and the hash of the previewed
 * transaction. Because propose takes nothing else, a model cannot "helpfully"
 * change a recipient or an amount between the review and the creation — it
 * would have to preview again, which shows a new card.
 *
 * Third token family sharing `JWT_SECRET`, distinguished by `typ` exactly as
 * `mcp_at` is distinguished from v1 bearers (`src/lib/oauth/accessToken.ts`).
 * A draft token verifies as neither: `verifyJwt` rejects it (no `address`),
 * `verifyAccessToken` rejects it (wrong `typ`, no audience).
 *
 * Short-lived on purpose: UTxOs move, and the review is only meaningful for as
 * long as the human's attention is on it.
 */

export const DRAFT_TOKEN_TYPE = "mcp_draft";
export const DRAFT_TOKEN_TTL_SECONDS = 15 * 60;

export type DraftTokenClaims = {
  typ: typeof DRAFT_TOKEN_TYPE;
  /** Acting address — must equal the caller's subject on propose. */
  sub: string;
  /** Wallet UUID. */
  wid: string;
  /** OAuth client id, or null for a v1 bearer caller. */
  cid: string | null;
  /** The normalized spec, base units. */
  spec: TxSpec;
  /** Hash of the previewed unsigned transaction. */
  ph: string;
  jti: string;
  iat: number;
  exp: number;
};

export type VerifiedDraftToken = {
  jti: string;
  subject: string;
  walletId: string;
  clientId: string | null;
  spec: TxSpec;
  previewTxHash: string;
  expiresAt: number;
};

export type DraftTokenFailure =
  | "malformed"
  | "expired"
  | "wrong_type"
  | "subject_mismatch"
  | "client_mismatch";

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is not defined");
  return value;
}

export function mintDraftToken(args: {
  subject: string;
  walletId: string;
  clientId: string | null;
  spec: TxSpec;
  previewTxHash: string;
}): { token: string; jti: string; expiresAt: number } {
  const jti = randomUUID();
  const token = sign(
    {
      typ: DRAFT_TOKEN_TYPE,
      sub: args.subject,
      wid: args.walletId,
      cid: args.clientId,
      spec: args.spec,
      ph: args.previewTxHash,
      jti,
    },
    secret(),
    { expiresIn: DRAFT_TOKEN_TTL_SECONDS },
  );
  const decoded = jwt.decode(token) as { exp?: number } | null;
  const expiresAt =
    decoded?.exp ?? Math.floor(Date.now() / 1000) + DRAFT_TOKEN_TTL_SECONDS;
  return { token, jti, expiresAt };
}

/**
 * Verify a draft token for the caller about to propose it.
 *
 * Subject and client are checked against the caller, not just the signature:
 * a token minted for one grant must not be redeemable through another, even
 * for the same human.
 */
export function verifyDraftToken(
  token: string,
  caller: { subject: string; clientId: string | null },
): { ok: true; claims: VerifiedDraftToken } | { ok: false; reason: DraftTokenFailure } {
  let claims: DraftTokenClaims;
  try {
    claims = verify(token, secret()) as DraftTokenClaims;
  } catch (error) {
    const name = (error as { name?: string })?.name;
    return { ok: false, reason: name === "TokenExpiredError" ? "expired" : "malformed" };
  }

  if (claims.typ !== DRAFT_TOKEN_TYPE) return { ok: false, reason: "wrong_type" };
  if (
    typeof claims.sub !== "string" ||
    typeof claims.wid !== "string" ||
    typeof claims.ph !== "string" ||
    typeof claims.jti !== "string" ||
    typeof claims.exp !== "number" ||
    !claims.spec ||
    typeof claims.spec !== "object"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (claims.sub !== caller.subject) {
    return { ok: false, reason: "subject_mismatch" };
  }
  if ((claims.cid ?? null) !== (caller.clientId ?? null)) {
    return { ok: false, reason: "client_mismatch" };
  }

  return {
    ok: true,
    claims: {
      jti: claims.jti,
      subject: claims.sub,
      walletId: claims.wid,
      clientId: claims.cid ?? null,
      spec: claims.spec,
      previewTxHash: claims.ph,
      expiresAt: claims.exp,
    },
  };
}

/** Human-readable failure for the tool error body. */
export function describeDraftTokenFailure(reason: DraftTokenFailure): string {
  switch (reason) {
    case "expired":
      return "The draft token has expired. Run transaction_preview again and confirm the new card.";
    case "subject_mismatch":
      return "The draft token was issued to a different address. Run transaction_preview again from this connection.";
    case "client_mismatch":
      return "The draft token was issued to a different MCP connection. Run transaction_preview again from this connection.";
    case "wrong_type":
      return "This is not a draft token. Pass the draftToken returned by transaction_preview.";
    default:
      return "The draft token could not be verified. Run transaction_preview again.";
  }
}
