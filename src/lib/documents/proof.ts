/**
 * Document Sign-Off (PRD-001) — proof package and its verifier.
 *
 * The proof package is the deliverable a team keeps: a self-contained JSON
 * envelope holding the document metadata, the exact content hash, the frozen
 * signer set + threshold, and every signer's signed payload and signature.
 *
 * `verifyProofPackage` deliberately takes the CIP-8 check as an argument. That
 * keeps this module free of any Cardano dependency, so the same code runs
 * server-side (with Mesh's `checkSignature`) and in an offline verifier with
 * whatever COSE_Sign1 implementation is at hand.
 */

import {
  SIGNOFF_DOMAIN,
  SIGNOFF_STATEMENTS,
  canonicalizeSignOffPayload,
  evaluateThreshold,
  isSha256Hex,
  normalizeContentHash,
  type SignOffAction,
  type SignOffPayload,
} from "./payload";

export const PROOF_FORMAT = "mesh-multisig.document-signoff.proof.v1";

export interface ProofReview {
  signerAddress: string;
  signerDescription?: string | null;
  /**
   * The contract party this signature was made as, and the capacity it was made
   * in. Absent for wallet-threshold sign-off, which is why both are optional —
   * a proof exported before contracts existed stays a valid ProofReview.
   */
  partyId?: string | null;
  partyRole?: string | null;
  action: SignOffAction;
  comment?: string | null;
  /** The canonical JSON string that was signed, verbatim. */
  payload: string;
  signature: string;
  signatureKey: string;
  signedAt: string;
}

export interface ProofPackage {
  format: typeof PROOF_FORMAT;
  exportedAt: string;
  document: {
    id: string;
    walletId: string;
    title: string;
    description?: string | null;
    documentType?: string | null;
    createdBy: string;
    createdAt: string;
  };
  version: {
    id: string;
    versionNumber: number;
    contentHash: string;
    hashAlgorithm: string;
    fileName?: string | null;
    mimeType?: string | null;
    fileSize?: number | null;
    status: string;
    createdBy: string;
    createdAt: string;
    reviewStartedAt?: string | null;
    decidedAt?: string | null;
  };
  policy: {
    walletId: string;
    walletPolicyHash: string;
    requiredSigners: number;
    signersAddresses: string[];
    signersDescriptions: string[];
    capturedAt: string;
  };
  reviews: ProofReview[];
  events: {
    type: string;
    actorAddress?: string | null;
    createdAt: string;
    metadata?: unknown;
  }[];
  verification: {
    domain: string;
    instructions: string[];
  };
}

export const VERIFICATION_INSTRUCTIONS = [
  "1. Re-hash the document bytes with the algorithm in `version.hashAlgorithm` and confirm the digest equals `version.contentHash`.",
  "2. For each entry in `reviews`, parse `payload` as JSON and confirm `contentHash`, `versionId`, `documentId`, `walletId` and `walletPolicyHash` match this package.",
  "3. Verify each `signature` (COSE_Sign1) over the exact `payload` string against the signer's address, per CIP-8.",
  '4. Count the entries with `action: "approve"` that passed step 3 and confirm the count is at least `policy.requiredSigners`.',
  "This package is an approval attestation by the wallet's signers. It is not a qualified electronic signature.",
];

/**
 * Why `value` cannot be read as a proof package at all, or null if it can.
 *
 * Structure only. It deliberately does not judge `format`: a package from a
 * later version of this format should still be *verified* and reported on,
 * because "every signature checks out but the format is newer than me" is a
 * far more useful answer to a counterparty than a flat rejection — and
 * {@link verifyProofPackage} already records an unknown format as a
 * verification error.
 */
export function proofPackageProblem(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return "That is not a Document Sign-Off proof package.";
  }
  const pkg = value as Partial<ProofPackage>;
  if (!pkg.version || !pkg.policy) {
    return "That JSON is not a Document Sign-Off proof package — it carries no version or policy.";
  }
  return null;
}

/**
 * JSON text to a proof package, for a paste box or a dropped file.
 *
 * Stricter than {@link proofPackageProblem} by one check: a reader who has just
 * pasted something wants to be told the format is unfamiliar before they press
 * a button, not after. Verification itself stays permissive.
 */
export function parseProofPackage(
  text: string,
): { ok: true; proof: ProofPackage } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not valid JSON." };
  }

  const problem = proofPackageProblem(value);
  if (problem !== null) return { ok: false, error: problem };

  const proof = value as ProofPackage;
  if (proof.format !== PROOF_FORMAT) {
    return {
      ok: false,
      error: `Unknown proof format "${String(proof.format)}". This verifier understands ${PROOF_FORMAT}.`,
    };
  }
  return { ok: true, proof };
}

/** Signature of the CIP-8 check the caller injects (Mesh's `checkSignature`). */
export type CheckSignatureFn = (
  data: string,
  signature: { key: string; signature: string },
  address?: string,
) => Promise<boolean>;

export interface ReviewVerdict {
  signerAddress: string;
  action: SignOffAction | null;
  /** All of the checks below passed. */
  valid: boolean;
  payloadWellFormed: boolean;
  payloadBindsToVersion: boolean;
  signerInSnapshot: boolean;
  signatureValid: boolean;
  errors: string[];
}

export interface ProofVerification {
  valid: boolean;
  format: string;
  /** Present only when the caller supplied a re-hashed digest to compare. */
  contentHashMatches?: boolean;
  approvals: number;
  rejections: number;
  requiredSigners: number;
  thresholdReached: boolean;
  reviews: ReviewVerdict[];
  errors: string[];
}

export interface VerifyProofOptions {
  /** Digest of the bytes the verifier holds — step 1 of the instructions. */
  expectedContentHash?: string;
  checkSignature: CheckSignatureFn;
}

export async function verifyProofPackage(
  pkg: ProofPackage,
  options: VerifyProofOptions,
): Promise<ProofVerification> {
  const errors: string[] = [];

  if (pkg.format !== PROOF_FORMAT) {
    errors.push(`Unknown proof format "${String(pkg.format)}"`);
  }
  if (!isSha256Hex(normalizeContentHash(pkg.version.contentHash))) {
    errors.push("version.contentHash is not a sha256 hex digest");
  }
  if (pkg.policy.requiredSigners < 1) {
    errors.push("policy.requiredSigners must be at least 1");
  }

  let contentHashMatches: boolean | undefined;
  if (options.expectedContentHash !== undefined) {
    contentHashMatches =
      normalizeContentHash(options.expectedContentHash) ===
      normalizeContentHash(pkg.version.contentHash);
    if (!contentHashMatches) {
      errors.push(
        "The supplied document does not hash to the approved content hash",
      );
    }
  }

  const snapshot = new Set(pkg.policy.signersAddresses);
  const seen = new Set<string>();
  const reviews: ReviewVerdict[] = [];

  for (const review of pkg.reviews) {
    const verdict = await verifyReview(
      review,
      pkg,
      snapshot,
      options.checkSignature,
    );
    if (seen.has(review.signerAddress)) {
      verdict.valid = false;
      verdict.errors.push("Duplicate review for this signer");
    }
    seen.add(review.signerAddress);
    reviews.push(verdict);
  }

  const approvals = reviews.filter(
    (r) => r.valid && r.action === "approve",
  ).length;
  const rejections = reviews.filter(
    (r) => r.valid && r.action === "reject",
  ).length;
  const outcome = evaluateThreshold({
    approvals,
    rejections,
    signerCount: pkg.policy.signersAddresses.length,
    requiredSigners: pkg.policy.requiredSigners,
  });

  const thresholdReached = outcome === "Approved";
  const allReviewsValid = reviews.every((r) => r.valid);

  return {
    valid:
      errors.length === 0 &&
      allReviewsValid &&
      thresholdReached &&
      contentHashMatches !== false,
    format: pkg.format,
    contentHashMatches,
    approvals,
    rejections,
    requiredSigners: pkg.policy.requiredSigners,
    thresholdReached,
    reviews,
    errors,
  };
}

async function verifyReview(
  review: ProofReview,
  pkg: ProofPackage,
  snapshot: Set<string>,
  checkSignature: CheckSignatureFn,
): Promise<ReviewVerdict> {
  const verdict: ReviewVerdict = {
    signerAddress: review.signerAddress,
    action: null,
    valid: false,
    payloadWellFormed: false,
    payloadBindsToVersion: false,
    signerInSnapshot: snapshot.has(review.signerAddress),
    signatureValid: false,
    errors: [],
  };

  if (!verdict.signerInSnapshot) {
    verdict.errors.push("Signer is not in the frozen signer snapshot");
  }

  let payload: SignOffPayload;
  try {
    payload = JSON.parse(review.payload) as SignOffPayload;
  } catch {
    verdict.errors.push("payload is not valid JSON");
    return verdict;
  }

  // The stored string must itself be canonical — otherwise two different
  // strings could carry the same JSON and only one of them is what was signed.
  if (canonicalizeSignOffPayload(payload) !== review.payload) {
    verdict.errors.push("payload is not in canonical form");
    return verdict;
  }
  verdict.payloadWellFormed = true;
  verdict.action = payload.action;

  const bindings: [string, unknown, unknown][] = [
    ["domain", payload.domain, SIGNOFF_DOMAIN],
    ["documentId", payload.documentId, pkg.document.id],
    ["versionId", payload.versionId, pkg.version.id],
    ["versionNumber", payload.versionNumber, pkg.version.versionNumber],
    [
      "contentHash",
      normalizeContentHash(payload.contentHash),
      normalizeContentHash(pkg.version.contentHash),
    ],
    ["walletId", payload.walletId, pkg.document.walletId],
    ["walletPolicyHash", payload.walletPolicyHash, pkg.policy.walletPolicyHash],
    ["signerAddress", payload.signerAddress, review.signerAddress],
    // Bound, not merely carried. Without this the capacity in the signed bytes
    // is never checked against the package, and role attribution — the whole
    // claim of a contract — would rest on an unverified field. `?? null` keeps
    // threshold reviews (no party either side) passing unchanged.
    ["partyId", payload.partyId ?? null, review.partyId ?? null],
    ["action", payload.action, review.action],
    ["comment", payload.comment, review.comment ?? ""],
    ["signedAt", payload.signedAt, review.signedAt],
  ];

  for (const [field, actual, expected] of bindings) {
    if (actual !== expected) {
      verdict.errors.push(
        `payload.${field} does not match the proof package (${String(actual)} ≠ ${String(expected)})`,
      );
    }
  }

  if (payload.statement !== SIGNOFF_STATEMENTS[payload.action]) {
    verdict.errors.push("payload.statement does not match the declared action");
  }

  verdict.payloadBindsToVersion = verdict.errors.length === 0;

  try {
    verdict.signatureValid = await checkSignature(
      review.payload,
      { key: review.signatureKey, signature: review.signature },
      review.signerAddress,
    );
  } catch (error) {
    verdict.signatureValid = false;
    verdict.errors.push(
      `Signature check threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!verdict.signatureValid) {
    verdict.errors.push("CIP-8 signature does not verify for this signer");
  }

  verdict.valid =
    verdict.payloadWellFormed &&
    verdict.payloadBindsToVersion &&
    verdict.signerInSnapshot &&
    verdict.signatureValid;

  return verdict;
}

// ---------------------------------------------------------------------------
// Building a package from stored rows
// ---------------------------------------------------------------------------

/** The row shapes a proof is built from — a structural subset of the Prisma models. */
export interface ProofSourceDocument {
  id: string;
  walletId: string;
  title: string;
  description: string | null;
  documentType: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface ProofSourceVersion {
  id: string;
  versionNumber: number;
  contentHash: string;
  hashAlgorithm: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  status: string;
  createdBy: string;
  createdAt: Date;
  reviewStartedAt: Date | null;
  decidedAt: Date | null;
}

export interface ProofSourceSnapshot {
  walletId: string;
  walletPolicyHash: string;
  requiredSigners: number;
  signersAddresses: string[];
  signersDescriptions: string[];
  capturedAt: Date;
}

export interface ProofSourceReview {
  signerAddress: string;
  partyId?: string | null;
  party?: { role: string } | null;
  action: SignOffAction;
  comment: string | null;
  payload: string;
  signature: string;
  signatureKey: string;
  signedAt: Date;
}

export interface ProofSourceEvent {
  versionId: string | null;
  type: string;
  actorAddress: string | null;
  createdAt: Date;
  metadata: unknown;
}

/**
 * Assemble the proof package for one version from its stored rows.
 *
 * Shared by `exportProof` and the audit export, so a version's proof inside an
 * audit bundle is byte-for-byte the package `exportProof` would have produced
 * (apart from `exportedAt`) and any proof verifier checks it unchanged.
 *
 * Events are filtered to the document-level ones plus this version's own.
 * Reviews are sorted by `signedAt` here rather than trusting the caller.
 */
export function buildProofPackage(input: {
  document: ProofSourceDocument;
  version: ProofSourceVersion;
  snapshot: ProofSourceSnapshot;
  reviews: readonly ProofSourceReview[];
  events: readonly ProofSourceEvent[];
  exportedAt: Date;
}): ProofPackage {
  const { document, version, snapshot } = input;

  const descriptionFor = (address: string): string | null => {
    const idx = snapshot.signersAddresses.indexOf(address);
    return idx >= 0 ? (snapshot.signersDescriptions[idx] ?? null) : null;
  };

  return {
    format: PROOF_FORMAT,
    exportedAt: input.exportedAt.toISOString(),
    document: {
      id: document.id,
      walletId: document.walletId,
      title: document.title,
      description: document.description,
      documentType: document.documentType,
      createdBy: document.createdBy,
      createdAt: document.createdAt.toISOString(),
    },
    version: {
      id: version.id,
      versionNumber: version.versionNumber,
      contentHash: version.contentHash,
      hashAlgorithm: version.hashAlgorithm,
      fileName: version.fileName,
      mimeType: version.mimeType,
      fileSize: version.fileSize,
      status: version.status,
      createdBy: version.createdBy,
      createdAt: version.createdAt.toISOString(),
      reviewStartedAt: version.reviewStartedAt?.toISOString() ?? null,
      decidedAt: version.decidedAt?.toISOString() ?? null,
    },
    policy: {
      walletId: snapshot.walletId,
      walletPolicyHash: snapshot.walletPolicyHash,
      requiredSigners: snapshot.requiredSigners,
      signersAddresses: snapshot.signersAddresses,
      signersDescriptions: snapshot.signersDescriptions,
      capturedAt: snapshot.capturedAt.toISOString(),
    },
    reviews: [...input.reviews]
      .sort((a, b) => a.signedAt.getTime() - b.signedAt.getTime())
      .map((r) => ({
        signerAddress: r.signerAddress,
        signerDescription: descriptionFor(r.signerAddress),
        // Only present for contract-party signatures. The verifier binds the
        // payload's partyId to this field, so omitting it would make every
        // party signature fail verification.
        ...(r.partyId
          ? { partyId: r.partyId, partyRole: r.party?.role ?? null }
          : {}),
        action: r.action,
        comment: r.comment,
        payload: r.payload,
        signature: r.signature,
        signatureKey: r.signatureKey,
        signedAt: r.signedAt.toISOString(),
      })),
    events: input.events
      .filter((e) => e.versionId === null || e.versionId === version.id)
      .map((e) => ({
        type: e.type,
        actorAddress: e.actorAddress,
        createdAt: e.createdAt.toISOString(),
        metadata: e.metadata,
      })),
    verification: {
      domain: SIGNOFF_DOMAIN,
      instructions: VERIFICATION_INSTRUCTIONS,
    },
  };
}
