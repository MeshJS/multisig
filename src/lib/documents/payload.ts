/**
 * Document Sign-Off (PRD-001) — the signed payload and the rules around it.
 *
 * Deliberately dependency-free (node `crypto` only). Two reasons:
 *  - the server rebuilds the payload from its own records and compares it to
 *    what the client submitted, so this module is on the trust path;
 *  - the same functions are what an offline verifier needs, so a proof package
 *    can be checked without the app, a database, or a Mesh install.
 *
 * A signer never signs a filename. They sign a structured statement that names
 * the exact content hash, the version it belongs to, the wallet whose policy
 * governs it, and what the action means in plain language.
 */

import { createHash } from "crypto";

/** Application domain — namespaces these signatures away from every other
 * `signData` use in the product (auth nonces, DRep votes, ballots). */
export const SIGNOFF_DOMAIN = "mesh-multisig.document-signoff.v1";

/** How far a client-asserted `signedAt` may drift from server time. */
export const SIGNED_AT_TOLERANCE_MS = 10 * 60 * 1000;

export type SignOffAction = "approve" | "reject";

export const SIGNOFF_STATEMENTS: Record<SignOffAction, string> = {
  approve: "I approve this exact document version for this wallet.",
  reject: "I reject this exact document version for this wallet.",
};

/**
 * The object a signer signs. Field names and order are part of the contract:
 * changing either invalidates every previously exported proof, so a change
 * means a new `SIGNOFF_DOMAIN` version.
 */
export interface SignOffPayload {
  action: SignOffAction;
  /**
   * The contract party this signature is made AS. Present only in parties mode.
   *
   * Optional on purpose. `canonicalize` drops undefined keys, so a threshold
   * signature produces byte-identical bytes to before this field existed and
   * every proof already issued keeps verifying — no SIGNOFF_DOMAIN bump.
   *
   * It has to be in the SIGNED bytes rather than beside them: a contract's
   * claim is "the Buyer signed as Buyer", and one human may hold two roles, so
   * without this two signatures from one address are indistinguishable and role
   * attribution would rest on a database column nobody signed.
   */
  partyId?: string;
  /** "" when no comment — the field is always present so it is always signed. */
  comment: string;
  contentHash: string;
  documentId: string;
  domain: string;
  /** ISO-8601, millisecond precision, UTC. */
  signedAt: string;
  signerAddress: string;
  statement: string;
  versionId: string;
  versionNumber: number;
  walletId: string;
  walletPolicyHash: string;
}

export interface BuildSignOffPayloadInput {
  action: SignOffAction;
  /** Set in parties mode only; omitted for wallet-threshold sign-off. */
  partyId?: string | null;
  comment?: string | null;
  contentHash: string;
  documentId: string;
  signedAt: Date | string;
  signerAddress: string;
  versionId: string;
  versionNumber: number;
  walletId: string;
  walletPolicyHash: string;
}

export function buildSignOffPayload(
  input: BuildSignOffPayloadInput,
): SignOffPayload {
  return {
    action: input.action,
    // undefined, never null: canonicalize filters undefined out, so a threshold
    // payload keeps exactly the byte layout it had before parties existed.
    ...(input.partyId ? { partyId: input.partyId } : {}),
    comment: input.comment ?? "",
    contentHash: input.contentHash,
    documentId: input.documentId,
    domain: SIGNOFF_DOMAIN,
    signedAt: toIsoMillis(input.signedAt),
    signerAddress: input.signerAddress,
    statement: SIGNOFF_STATEMENTS[input.action],
    versionId: input.versionId,
    versionNumber: input.versionNumber,
    walletId: input.walletId,
    walletPolicyHash: input.walletPolicyHash,
  };
}

/**
 * Deterministic JSON: keys sorted, no incidental whitespace. Both sides must
 * produce byte-identical output or the signature check is meaningless.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}

/** The exact string handed to `wallet.signData` and stored on the review. */
export function canonicalizeSignOffPayload(payload: SignOffPayload): string {
  return canonicalize(payload);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Binds a review round to the wallet policy that governed it. */
export function walletPolicyHash(scriptCbor: string): string {
  return sha256Hex(scriptCbor);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

/** Normalizes a user-supplied digest before it is stored or compared. */
export function normalizeContentHash(value: string): string {
  return value.trim().toLowerCase();
}

function toIsoMillis(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new Error("signedAt is not a valid date");
  }
  return date.toISOString();
}

export function isSignedAtWithinTolerance(
  signedAt: Date | string,
  now: Date = new Date(),
  toleranceMs: number = SIGNED_AT_TOLERANCE_MS,
): boolean {
  const date = typeof signedAt === "string" ? new Date(signedAt) : signedAt;
  if (Number.isNaN(date.getTime())) return false;
  return Math.abs(date.getTime() - now.getTime()) <= toleranceMs;
}

// ---------------------------------------------------------------------------
// Threshold evaluation
// ---------------------------------------------------------------------------

export type ThresholdOutcome = "InReview" | "Approved" | "Rejected";

export interface ThresholdInput {
  approvals: number;
  rejections: number;
  /** Signers in the frozen snapshot, not the live wallet. */
  signerCount: number;
  requiredSigners: number;
}

/**
 * A round resolves as soon as the answer is certain:
 *  - approvals reach the threshold → Approved;
 *  - enough signers have rejected that the threshold is unreachable → Rejected.
 * Anything else is still open.
 */
export interface ContractPartyOutcomeInput {
  /** Every party on the contract, required and optional alike. */
  parties: readonly { id: string; required: boolean }[];
  /** Reviews recorded against this version, party-attributed. */
  reviews: readonly { partyId: string | null; action: SignOffAction }[];
}

/**
 * The outcome rule for parties mode.
 *
 * `evaluateThreshold` cannot decide a contract, and the reason is worth stating
 * once: it counts approvals ANONYMOUSLY. Put an optional Witness into the
 * snapshot and a contract can reach the count while a REQUIRED party has
 * explicitly rejected it — Approved over a refusal. Take the Witness out and
 * they are denied at submission instead. Neither is a contract.
 *
 * So this rule is about WHICH parties acted, not how many:
 *
 *   Approved  every required party approved
 *   Rejected  any required party rejected — one refusal ends it, because
 *             every required signature is load-bearing in an N-of-N agreement
 *   InReview  otherwise
 *
 * Optional parties are recorded and never counted: they may sign or decline
 * and neither moves the outcome.
 */
export function evaluateContractOutcome(
  input: ContractPartyOutcomeInput,
): ThresholdOutcome {
  const required = input.parties.filter((p) => p.required);

  // A party set with nothing required would make "every required party
  // approved" vacuously true and approve a contract nobody signed. startReview
  // must refuse such a set; this refuses to call it decided in the meantime.
  if (required.length === 0) return "InReview";

  const byParty = new Map<string, SignOffAction>();
  for (const review of input.reviews) {
    if (review.partyId) byParty.set(review.partyId, review.action);
  }

  if (required.some((p) => byParty.get(p.id) === "reject")) return "Rejected";
  if (required.every((p) => byParty.get(p.id) === "approve")) return "Approved";
  return "InReview";
}

export function evaluateThreshold(input: ThresholdInput): ThresholdOutcome {
  const { approvals, rejections, signerCount, requiredSigners } = input;
  if (approvals >= requiredSigners) return "Approved";
  const stillPossible = signerCount - rejections;
  if (stillPossible < requiredSigners) return "Rejected";
  return "InReview";
}
