/**
 * Document Sign-Off v1 (Revision Provenance) — the audit export.
 *
 * A proof package (`proof.ts`) answers one question about one version: did the
 * wallet's signers approve these exact bytes? An audit package answers the
 * question an auditor asks about the whole document: what happened, in what
 * order, and can I check it without trusting this database?
 *
 * It bundles, for every version:
 *  - the version row and its lineage (what it superseded, what it restored),
 *  - its proof package, built by the same `buildProofPackage` that
 *    `exportProof` uses, so any proof verifier checks it unchanged,
 *  - its position in the platform attestation chain,
 * plus the full event log and the attestation chain with the public keys.
 *
 * `verifyAuditPackage` re-runs every check offline: each version's signatures,
 * the attestation chain, and the cross-checks that tie the two together (every
 * version attested once, at its own hash; every restore carrying the hash of
 * the version it names). Like proof.ts it takes the CIP-8 check as an argument
 * and has no Cardano dependency.
 *
 * A new format rather than more fields on `proof.v1`: that format's field
 * names are a contract existing verifiers parse.
 */

import {
  ATTESTATION_DOMAIN,
  ATTESTATION_STATEMENT,
  verifyAttestationChain,
  type AttestationPayload,
  type AttestationRecord,
  type ChainVerification,
} from "./attestation";
import { normalizeContentHash } from "./payload";
import {
  PROOF_LIMITS,
  buildProofPackage,
  proofShapeProblem,
  verifyProofPackage,
  type CheckSignatureFn,
  type ProofPackage,
  type ProofSourceDocument,
  type ProofSourceEvent,
  type ProofSourceReview,
  type ProofSourceSnapshot,
  type ProofSourceVersion,
} from "./proof";

export const AUDIT_FORMAT = "mesh-multisig.document-signoff.audit.v1";

/** How a version came to exist, read from the event that created it. */
export type VersionOrigin = "upload" | "draft" | "restore" | "unknown";

export interface AuditVersion {
  version: ProofPackage["version"] & {
    storageMode: string;
    contentRef: string | null;
    reviewInstructions: string | null;
    supersededAt: string | null;
  };
  lineage: {
    origin: VersionOrigin;
    /** Version number this one superseded, if any. */
    supersedes: number | null;
    /** For a restore: the version whose content this one re-publishes. */
    restoredFrom: number | null;
  };
  /** Null when no review round was ever started for this version. */
  proof: ProofPackage | null;
  /** Position in the attestation chain, or null when the version is unattested. */
  attestationSequence: number | null;
}

export interface AuditPackage {
  format: typeof AUDIT_FORMAT;
  exportedAt: string;
  document: ProofPackage["document"] & {
    status: string;
    signingMode: string;
    archivedAt: string | null;
  };
  /** Ascending by version number. */
  versions: AuditVersion[];
  /**
   * The whole log, ascending — document-level and every version's. Each entry
   * names its version, so lineage and review rounds can be re-derived here.
   */
  events: (ProofPackage["events"][number] & { versionId: string | null })[];
  /** Null when the deployment has no attestation key configured. */
  attestation: {
    domain: string;
    statement: string;
    /** Key id → SPKI DER hex, as published by the exporting deployment. */
    publicKeys: Record<string, string>;
    chain: AttestationRecord[];
  } | null;
  verification: {
    domain: typeof AUDIT_FORMAT;
    instructions: string[];
  };
}

export const AUDIT_INSTRUCTIONS = [
  "1. Versions must run 1..N without gaps. For each version with a `proof`, verify that proof exactly as a standalone `proof.v1` package — its four steps are in `proof.verification.instructions`.",
  "2. If `attestation` is present, verify the chain: each payload is signed (Ed25519) by the key named in `publicKeyId`, links to the SHA-256 of the previous canonical payload, and runs sequence 1..N in non-decreasing time. Prefer public keys you obtained independently over the ones in this file.",
  "3. Cross-check: every version appears in the chain exactly once, with the same versionId, versionNumber and contentHash.",
  "4. A version whose lineage says `restoredFrom: k` must carry the same contentHash as version k. A restore re-publishes old bytes as a new version; it never carries the old version's approvals forward.",
  "5. Lineage and review rounds must agree with `events`: each version's origin is the event that created it, and a version with a `review.started` event must carry a proof whose threshold matches that event.",
  "What is authenticated: the CIP-8 signatures (by the signers) and the attestation chain (by the platform key). The event log, lineage, statuses and each round's threshold are records from the exporting database — consistent with the signed material when this verifies, but not themselves signed.",
  "The attestation chain is a timestamp and ordering record by the platform. It is not an approval. Approval is the CIP-8 signatures inside each version's proof.",
];

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface AuditSourceVersion extends ProofSourceVersion {
  storageMode: string;
  contentRef: string | null;
  reviewInstructions: string | null;
  supersededAt: Date | null;
  signerSnapshot: ProofSourceSnapshot | null;
  reviews: readonly ProofSourceReview[];
}

export interface AuditSourceEvent extends ProofSourceEvent {
  metadata: unknown;
}

export interface AuditSourceAttestation {
  versionId: string;
  sequence: number;
  /** The exact canonical JSON that was signed. */
  payload: string;
  signature: string;
  publicKeyId: string;
}

function metadataNumber(metadata: unknown, key: string): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Lineage for every version, from the event log.
 *
 * The event that created a version names how it was made; the matching
 * `version.superseded` event (same transaction) names what it replaced. Reading
 * this from events rather than inferring it from version numbers is what lets a
 * restore of v2 as v5 be told apart from an ordinary v5 upload.
 */
export function versionLineage(
  versions: readonly { id: string; versionNumber: number }[],
  events: readonly {
    versionId: string | null;
    type: string;
    metadata?: unknown;
  }[],
): Map<string, AuditVersion["lineage"]> {
  const byId = new Map<string, AuditVersion["lineage"]>();
  const sorted = [...versions].sort(
    (a, b) => a.versionNumber - b.versionNumber,
  );

  for (const [index, version] of sorted.entries()) {
    const created = events.find(
      (e) =>
        e.versionId === version.id &&
        (e.type === "version.uploaded" ||
          e.type === "version.published" ||
          e.type === "version.restored"),
    );
    const origin: VersionOrigin =
      created?.type === "version.uploaded"
        ? "upload"
        : created?.type === "version.published"
          ? "draft"
          : created?.type === "version.restored"
            ? "restore"
            : "unknown";

    byId.set(version.id, {
      origin,
      supersedes: index > 0 ? sorted[index - 1]!.versionNumber : null,
      restoredFrom:
        origin === "restore"
          ? metadataNumber(created?.metadata, "restoredFromVersionNumber")
          : null,
    });
  }
  return byId;
}

export function buildAuditPackage(input: {
  document: ProofSourceDocument & {
    status: string;
    signingMode: string;
    archivedAt: Date | null;
  };
  versions: readonly AuditSourceVersion[];
  events: readonly AuditSourceEvent[];
  attestations: readonly AuditSourceAttestation[];
  publicKeys: Record<string, string>;
  exportedAt: Date;
}): AuditPackage {
  const { document } = input;
  const events = [...input.events].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const versions = [...input.versions].sort(
    (a, b) => a.versionNumber - b.versionNumber,
  );
  const attestations = [...input.attestations].sort(
    (a, b) => a.sequence - b.sequence,
  );
  const lineage = versionLineage(versions, events);
  const sequenceFor = new Map(
    attestations.map((a) => [a.versionId, a.sequence]),
  );

  return {
    format: AUDIT_FORMAT,
    exportedAt: input.exportedAt.toISOString(),
    document: {
      id: document.id,
      walletId: document.walletId,
      title: document.title,
      description: document.description,
      documentType: document.documentType,
      createdBy: document.createdBy,
      createdAt: document.createdAt.toISOString(),
      status: document.status,
      signingMode: document.signingMode,
      archivedAt: document.archivedAt?.toISOString() ?? null,
    },
    versions: versions.map((v) => ({
      version: {
        id: v.id,
        versionNumber: v.versionNumber,
        contentHash: v.contentHash,
        hashAlgorithm: v.hashAlgorithm,
        fileName: v.fileName,
        mimeType: v.mimeType,
        fileSize: v.fileSize,
        status: v.status,
        createdBy: v.createdBy,
        createdAt: v.createdAt.toISOString(),
        reviewStartedAt: v.reviewStartedAt?.toISOString() ?? null,
        decidedAt: v.decidedAt?.toISOString() ?? null,
        storageMode: v.storageMode,
        contentRef: v.contentRef,
        reviewInstructions: v.reviewInstructions,
        supersededAt: v.supersededAt?.toISOString() ?? null,
      },
      lineage: lineage.get(v.id)!,
      proof: v.signerSnapshot
        ? buildProofPackage({
            document,
            version: v,
            snapshot: v.signerSnapshot,
            reviews: v.reviews,
            events,
            exportedAt: input.exportedAt,
          })
        : null,
      attestationSequence: sequenceFor.get(v.id) ?? null,
    })),
    events: events.map((e) => ({
      versionId: e.versionId,
      type: e.type,
      actorAddress: e.actorAddress,
      createdAt: e.createdAt.toISOString(),
      metadata: e.metadata,
    })),
    attestation:
      attestations.length > 0
        ? {
            domain: ATTESTATION_DOMAIN,
            statement: ATTESTATION_STATEMENT,
            publicKeys: input.publicKeys,
            chain: attestations.map((a) => ({
              payload: JSON.parse(a.payload) as AttestationPayload,
              signature: a.signature,
              publicKeyId: a.publicKeyId,
            })),
          }
        : null,
    verification: {
      domain: AUDIT_FORMAT,
      instructions: AUDIT_INSTRUCTIONS,
    },
  };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export interface AuditVersionVerdict {
  versionNumber: number;
  status: string;
  hasProof: boolean;
  /** Every review's payload binds to this version and its signature verifies. */
  signaturesValid: boolean;
  approvals: number;
  rejections: number;
  requiredSigners: number | null;
  thresholdReached: boolean;
  errors: string[];
}

export interface AuditVerification {
  /** Every check passed. A version that was never approved does not fail this. */
  valid: boolean;
  format: string;
  versions: AuditVersionVerdict[];
  chain: ChainVerification | null;
  /**
   * True when the chain was checked against keys carried in the package itself.
   * That proves internal consistency only; pass `publicKeys` obtained
   * independently to prove it came from the deployment that holds them.
   */
  keysFromPackage: boolean;
  errors: string[];
  /** Not failures, but worth an auditor's attention. */
  warnings: string[];
}

export async function verifyAuditPackage(
  pkg: AuditPackage,
  options: {
    checkSignature: CheckSignatureFn;
    publicKeys?: Readonly<Record<string, string>>;
    /**
     * Treat a missing attestation chain as an error rather than a warning —
     * for a verifier that knows the exporting deployment attests, so that
     * stripping the chain cannot be used to hide a tampered version.
     */
    requireAttestation?: boolean;
  },
): Promise<AuditVerification> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (pkg.format !== AUDIT_FORMAT) {
    errors.push(`Unknown audit format "${String(pkg.format)}"`);
  }

  const byNumber = new Map<number, AuditVersion>();
  pkg.versions.forEach((entry, index) => {
    const n = entry.version.versionNumber;
    if (n !== index + 1) {
      errors.push(
        `Versions must run 1..N in order; position ${index + 1} holds v${n}.`,
      );
    }
    byNumber.set(n, entry);
  });

  if (pkg.versions.length > 0 && pkg.events.length === 0) {
    errors.push("The event log is empty, but the document has versions.");
  }
  const lineage = versionLineage(
    pkg.versions.map((v) => v.version),
    pkg.events,
  );
  const roundStarted = new Map<string, { requiredSigners?: number }>();
  for (const e of pkg.events) {
    if (e.type !== "review.started" || !e.versionId) continue;
    const meta = e.metadata as { requiredSigners?: unknown } | null;
    roundStarted.set(e.versionId, {
      requiredSigners:
        typeof meta?.requiredSigners === "number"
          ? meta.requiredSigners
          : undefined,
    });
  }

  const verdicts: AuditVersionVerdict[] = [];
  for (const entry of pkg.versions) {
    const n = entry.version.versionNumber;
    const verdict: AuditVersionVerdict = {
      versionNumber: n,
      status: entry.version.status,
      hasProof: entry.proof !== null,
      signaturesValid: true,
      approvals: 0,
      rejections: 0,
      requiredSigners: null,
      thresholdReached: false,
      errors: [],
    };

    if (entry.proof) {
      const proof = entry.proof;
      if (
        proof.document.id !== pkg.document.id ||
        proof.document.walletId !== pkg.document.walletId
      ) {
        verdict.errors.push("proof belongs to a different document or wallet");
      }
      if (
        proof.version.id !== entry.version.id ||
        proof.version.versionNumber !== n ||
        normalizeContentHash(proof.version.contentHash) !==
          normalizeContentHash(entry.version.contentHash)
      ) {
        verdict.errors.push("proof does not describe this version");
      }
      const result = await verifyProofPackage(proof, {
        checkSignature: options.checkSignature,
      });
      verdict.signaturesValid = result.reviews.every((r) => r.valid);
      verdict.approvals = result.approvals;
      verdict.rejections = result.rejections;
      verdict.requiredSigners = result.requiredSigners;
      verdict.thresholdReached = result.thresholdReached;
      for (const e of result.errors) verdict.errors.push(`proof: ${e}`);
      for (const r of result.reviews) {
        for (const e of r.errors)
          verdict.errors.push(`${r.signerAddress}: ${e}`);
      }
      // The threshold is not in any signed payload, so it is cross-checked
      // against the log entry that started the round.
      const started = roundStarted.get(entry.version.id);
      if (
        started?.requiredSigners !== undefined &&
        started.requiredSigners !== proof.policy.requiredSigners
      ) {
        verdict.errors.push(
          `proof says ${proof.policy.requiredSigners} required signers, the round started with ${started.requiredSigners}`,
        );
      }
      // A version marked Approved must actually carry enough valid approvals.
      if (entry.version.status === "Approved" && !result.thresholdReached) {
        verdict.errors.push(
          "marked Approved but its valid approvals do not reach the threshold",
        );
      }
    } else if (
      entry.version.status === "Approved" ||
      entry.version.status === "Rejected"
    ) {
      verdict.errors.push(
        `marked ${entry.version.status} but carries no review round`,
      );
    } else if (roundStarted.has(entry.version.id)) {
      verdict.errors.push(
        "the log shows a review round for this version, but no proof was included",
      );
    }

    const derived = lineage.get(entry.version.id);
    if (
      !derived ||
      derived.origin !== entry.lineage.origin ||
      derived.restoredFrom !== entry.lineage.restoredFrom ||
      derived.supersedes !== entry.lineage.supersedes
    ) {
      verdict.errors.push("stated lineage does not match the event log");
    }

    if (entry.lineage.origin === "restore") {
      const source =
        entry.lineage.restoredFrom === null
          ? undefined
          : byNumber.get(entry.lineage.restoredFrom);
      if (!source) {
        verdict.errors.push(
          "restore names a version that is not in this package",
        );
      } else if (
        normalizeContentHash(source.version.contentHash) !==
        normalizeContentHash(entry.version.contentHash)
      ) {
        verdict.errors.push(
          `restore of v${source.version.versionNumber} does not carry its content hash`,
        );
      } else if (source.version.versionNumber >= n) {
        verdict.errors.push("restore names a later version");
      }
    }

    verdicts.push(verdict);
  }

  let chain: ChainVerification | null = null;
  const keysFromPackage = !options.publicKeys;
  if (pkg.attestation) {
    chain = verifyAttestationChain(
      pkg.attestation.chain,
      options.publicKeys ?? pkg.attestation.publicKeys,
    );

    const seen = new Set<string>();
    for (const record of pkg.attestation.chain) {
      const p = record.payload;
      const entry = byNumber.get(p.versionNumber);
      if (
        p.documentId !== pkg.document.id ||
        p.walletId !== pkg.document.walletId
      ) {
        errors.push(
          `attestation ${p.sequence} names a different document or wallet`,
        );
      }
      if (!entry || entry.version.id !== p.versionId) {
        errors.push(
          `attestation ${p.sequence} names v${p.versionNumber}, which is not in this package`,
        );
        continue;
      }
      if (
        normalizeContentHash(entry.version.contentHash) !==
        normalizeContentHash(p.contentHash)
      ) {
        errors.push(
          `attestation ${p.sequence} attests a different content hash than v${p.versionNumber}`,
        );
      }
      if (entry.attestationSequence !== p.sequence) {
        errors.push(
          `v${p.versionNumber} claims attestation ${String(entry.attestationSequence)}, chain says ${p.sequence}`,
        );
      }
      if (seen.has(p.versionId)) {
        errors.push(`v${p.versionNumber} is attested more than once`);
      }
      seen.add(p.versionId);
    }
    // Attestation is optional per deployment, so a key configured part-way
    // through a document's life leaves its earliest versions unattested. That
    // is a warning. A version AFTER the first attested one with no link is a
    // gap in the record, and that is an error.
    const firstAttested = pkg.attestation.chain.reduce(
      (min, r) => Math.min(min, r.payload.versionNumber),
      Infinity,
    );
    for (const entry of pkg.versions) {
      if (seen.has(entry.version.id)) continue;
      const n = entry.version.versionNumber;
      if (n < firstAttested) {
        warnings.push(
          `v${n} predates the attestation chain (attestation began at v${firstAttested})`,
        );
      } else {
        errors.push(`v${n} is missing from the attestation chain`);
      }
    }
  } else if (pkg.versions.length > 0) {
    if (options.requireAttestation) {
      errors.push(
        "No attestation chain, but this verifier expects the exporting deployment to attest.",
      );
    } else {
      warnings.push(
        "No attestation chain: version order and timing rest on the exporting database alone.",
      );
    }
  }
  if (keysFromPackage && pkg.attestation) {
    warnings.push(
      "The chain was checked against public keys carried in this file. Supply keys obtained independently to rule out a re-signed export.",
    );
  }

  return {
    valid:
      errors.length === 0 &&
      verdicts.every((v) => v.errors.length === 0 && v.signaturesValid) &&
      (chain === null || chain.ok),
    format: pkg.format,
    versions: verdicts,
    chain,
    keysFromPackage,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Shape check for untrusted input
// ---------------------------------------------------------------------------

/** Caps for a package arriving at a public endpoint. Real documents sit far below. */
export const AUDIT_LIMITS = {
  versions: 500,
  reviewsPerVersion: PROOF_LIMITS.reviews,
  chain: 500,
  events: 20_000,
} as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isNullableString = (v: unknown) => v === null || isString(v);

function proofProblem(proof: unknown, where: string): string | null {
  const problem = proofShapeProblem(proof);
  return problem === null ? null : `${where}: ${problem}`;
}

/**
 * Why `value` cannot be verified as an audit package, or null if it can.
 *
 * Structural, and bounded: the verify endpoint is public, so malformed input
 * must come back as a clear 400 rather than a TypeError, and a package padded
 * with thousands of signatures must not buy unbounded CIP-8 work.
 */
export function auditPackageProblem(value: unknown): string | null {
  if (!isObject(value)) return "That is not a Document Sign-Off audit package.";
  const { document, versions, events, attestation } = value;
  if (
    !isObject(document) ||
    !isString(document.id) ||
    !isString(document.walletId)
  ) {
    return "That is not a Document Sign-Off audit package — it carries no document.";
  }
  if (!Array.isArray(versions) || versions.length > AUDIT_LIMITS.versions) {
    return `versions must be an array of at most ${AUDIT_LIMITS.versions}`;
  }
  if (!Array.isArray(events) || events.length > AUDIT_LIMITS.events) {
    return `events must be an array of at most ${AUDIT_LIMITS.events}`;
  }
  for (const e of events) {
    if (
      !isObject(e) ||
      !isString(e.type) ||
      !isNullableString(e.versionId ?? null)
    ) {
      return "an event is malformed";
    }
  }
  for (const [i, entry] of versions.entries()) {
    const where = `versions[${i}]`;
    if (!isObject(entry)) return `${where} is not an object`;
    const { version, lineage, proof } = entry;
    if (
      !isObject(version) ||
      !isString(version.id) ||
      !isInt(version.versionNumber) ||
      !isString(version.contentHash) ||
      !isString(version.status)
    ) {
      return `${where}.version is malformed`;
    }
    if (
      !isObject(lineage) ||
      !isString(lineage.origin) ||
      !(lineage.supersedes === null || isInt(lineage.supersedes)) ||
      !(lineage.restoredFrom === null || isInt(lineage.restoredFrom))
    ) {
      return `${where}.lineage is malformed`;
    }
    if (proof !== null) {
      const problem = proofProblem(proof, where);
      if (problem) return problem;
    }
  }
  if (attestation !== null) {
    if (
      !isObject(attestation) ||
      !Array.isArray(attestation.chain) ||
      !isObject(attestation.publicKeys)
    ) {
      return "attestation is malformed";
    }
    if (attestation.chain.length > AUDIT_LIMITS.chain) {
      return `attestation.chain is longer than ${AUDIT_LIMITS.chain}`;
    }
    for (const r of attestation.chain) {
      if (
        !isObject(r) ||
        !isObject(r.payload) ||
        !isString(r.signature) ||
        !isString(r.publicKeyId) ||
        !isInt(r.payload.versionNumber) ||
        !isInt(r.payload.sequence) ||
        !isString(r.payload.versionId) ||
        !isString(r.payload.contentHash)
      ) {
        return "an attestation record is malformed";
      }
    }
  }
  return null;
}
