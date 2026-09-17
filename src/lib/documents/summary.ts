import { evaluateThreshold } from "./payload";

/**
 * Compact projections of a document for the REST/MCP surface.
 *
 * Two reasons this exists rather than returning the Prisma rows:
 *
 *  - SIZE. A version may carry up to 512KB of inline base64 (`contentInline`).
 *    Handing that to a model as tool output is pure waste, and it is never what
 *    a caller asking "what needs signing?" wants.
 *  - RESTRAINT. These endpoints back MCP tools, so whatever they return becomes
 *    model context. The projection is an allowlist: fields are here because a
 *    caller needs them, so a new column on DocumentVersion cannot silently
 *    start flowing to a model.
 *
 * Titles, descriptions and comments ARE included — they are the point of the
 * feature and cannot be withheld — but they are user-authored strings, which is
 * exactly why nothing on this surface can write or sign.
 */

type ReviewLike = {
  signerAddress: string;
  action: string;
  signedAt?: Date | string | null;
  comment?: string | null;
};

type SnapshotLike = {
  signersAddresses: string[];
  requiredSigners: number;
} | null;

type VersionLike = {
  id: string;
  versionNumber: number;
  contentHash: string;
  hashAlgorithm: string;
  status: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  storageMode: string;
  createdBy: string;
  createdAt: Date | string;
  decidedAt?: Date | string | null;
  supersededAt?: Date | string | null;
  reviews?: ReviewLike[];
  signerSnapshot?: SnapshotLike;
};

type DocumentLike = {
  id: string;
  walletId: string;
  title: string;
  description?: string | null;
  documentType?: string | null;
  status: string;
  createdBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  versions?: VersionLike[];
};

const iso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

export function summariseVersion(version: VersionLike) {
  const reviews = version.reviews ?? [];
  const approvals = reviews.filter((r) => r.action === "approve").length;
  const rejections = reviews.filter((r) => r.action === "reject").length;
  const snapshot = version.signerSnapshot ?? null;

  const acted = new Set(reviews.map((r) => r.signerAddress));
  const awaiting = (snapshot?.signersAddresses ?? []).filter(
    (address) => !acted.has(address),
  );

  return {
    versionId: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    contentHash: version.contentHash,
    hashAlgorithm: version.hashAlgorithm,
    fileName: version.fileName ?? null,
    mimeType: version.mimeType ?? null,
    fileSize: version.fileSize ?? null,
    storageMode: version.storageMode,
    createdBy: version.createdBy,
    createdAt: iso(version.createdAt),
    decidedAt: iso(version.decidedAt),
    supersededAt: iso(version.supersededAt),
    approvals,
    rejections,
    requiredSigners: snapshot?.requiredSigners ?? null,
    // Only meaningful once a round has started and a snapshot exists.
    awaitingSignatures: snapshot ? awaiting : null,
    // Recomputed from the frozen snapshot rather than read off the row, so a
    // caller sees the same rule the server enforces.
    outcome: snapshot
      ? evaluateThreshold({
          approvals,
          rejections,
          signerCount: snapshot.signersAddresses.length,
          requiredSigners: snapshot.requiredSigners,
        })
      : null,
  };
}

export function summariseDocument(document: DocumentLike) {
  const versions = (document.versions ?? []).map(summariseVersion);
  return {
    documentId: document.id,
    walletId: document.walletId,
    title: document.title,
    description: document.description ?? null,
    documentType: document.documentType ?? null,
    status: document.status,
    createdBy: document.createdBy,
    createdAt: iso(document.createdAt),
    updatedAt: iso(document.updatedAt),
    versionCount: versions.length,
    /** Highest version number — the one a signer would act on. */
    latestVersion: versions[0] ?? null,
    versions,
  };
}
