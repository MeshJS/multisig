/**
 * Platform attestation — a timestamp and ordering record over document
 * versions, and nothing else.
 *
 * WHAT THIS IS NOT
 *
 * This is not an approval and carries no authority. Enactment stays entirely
 * with the human signers: a document becomes Approved only when enough wallet
 * signers produce CIP-8 signatures over the sign-off statement in `payload.ts`,
 * against the frozen `DocumentSignerSnapshot`. The platform key is deliberately
 * outside that path.
 *
 * That boundary is what makes holding a key here acceptable. Compromise of the
 * attestation key lets an attacker forge or reorder timestamps — a real
 * audit-integrity problem — but it cannot approve a document, cannot change a
 * threshold, and cannot move a lovelace. The statement below is part of the
 * signed bytes precisely so that a recipient cannot be told otherwise.
 *
 * WHAT IT GIVES YOU
 *
 * Each version is attested once, and every attestation commits to the hash of
 * the previous attestation for that document. The result is an append-only
 * chain: inserting, removing, reordering or back-dating a version breaks the
 * links, and the break is detectable by anyone holding the public key. That is
 * the "traceable version control" property — the history is tamper-evident
 * independently of the database it is stored in.
 *
 * Dependency-free (node `crypto` only), for the same reason as `payload.ts` and
 * `proof.ts`: a third party must be able to verify a chain without this app, a
 * database, or a Mesh install.
 */

import { createHash, createPublicKey, sign, verify } from "crypto";

import { canonicalize, isSha256Hex, sha256Hex } from "./payload";

/** Namespaces these signatures away from every other signature in the product. */
export const ATTESTATION_DOMAIN = "mesh-multisig.document-attestation.v1";

/**
 * Signed verbatim as part of every attestation. A relying party reading the
 * bytes is told, by the bytes, exactly how much this signature means.
 */
export const ATTESTATION_STATEMENT =
  "Mesh Multisig recorded this document version at this time and in this " +
  "position in the document's history. This is a timestamp and ordering " +
  "record only. It is not an approval, it expresses no opinion on the " +
  "content, and it grants no authority. Only the wallet's human signers can " +
  "approve a version.";

/** `prevAttestationHash` of the first attestation in a document's chain. */
export const GENESIS_PREV = "0".repeat(64);

/**
 * The object the platform signs. Field names are part of the contract:
 * changing them invalidates every previously issued attestation, so a change
 * means a new {@link ATTESTATION_DOMAIN} version.
 */
export interface AttestationPayload {
  /** Server clock, ISO with milliseconds, UTC. */
  attestedAt: string;
  contentHash: string;
  documentId: string;
  domain: string;
  /** Previous link in this document's chain, or {@link GENESIS_PREV}. */
  prevAttestationHash: string;
  /** 1-based position in this document's chain. */
  sequence: number;
  statement: string;
  versionId: string;
  versionNumber: number;
  walletId: string;
}

export interface BuildAttestationInput {
  attestedAt: Date;
  contentHash: string;
  documentId: string;
  prevAttestationHash: string;
  sequence: number;
  versionId: string;
  versionNumber: number;
  walletId: string;
}

export function buildAttestationPayload(
  input: BuildAttestationInput,
): AttestationPayload {
  return {
    attestedAt: input.attestedAt.toISOString(),
    contentHash: input.contentHash.toLowerCase(),
    documentId: input.documentId,
    domain: ATTESTATION_DOMAIN,
    prevAttestationHash: input.prevAttestationHash.toLowerCase(),
    sequence: input.sequence,
    statement: ATTESTATION_STATEMENT,
    versionId: input.versionId,
    versionNumber: input.versionNumber,
    walletId: input.walletId,
  };
}

/** The exact bytes that are signed and chained over. */
export function canonicalizeAttestation(payload: AttestationPayload): string {
  return canonicalize(payload);
}

/** This attestation's link value — what the NEXT one commits to. */
export function attestationHash(payload: AttestationPayload): string {
  return sha256Hex(canonicalizeAttestation(payload));
}

/**
 * Stable short name for a public key, so an attestation says which key signed
 * it and a key can be rotated without orphaning past attestations.
 */
export function attestationKeyId(publicKeySpkiHex: string): string {
  return createHash("sha256")
    .update(publicKeySpkiHex.toLowerCase(), "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** Ed25519 signature over the canonical bytes, as lowercase hex. */
export function signAttestation(
  payload: AttestationPayload,
  privateKey: Parameters<typeof sign>[2],
): string {
  return sign(
    null,
    Buffer.from(canonicalizeAttestation(payload), "utf8"),
    privateKey,
  ).toString("hex");
}

/**
 * Verify one attestation against a public key given as SPKI DER hex — the form
 * carried in a proof package, so an offline verifier needs nothing else.
 */
export function verifyAttestation(
  payload: AttestationPayload,
  signatureHex: string,
  publicKeySpkiHex: string,
): boolean {
  if (!/^[0-9a-f]+$/i.test(signatureHex) || signatureHex.length !== 128) {
    return false;
  }
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: Buffer.from(publicKeySpkiHex, "hex"),
      format: "der",
      type: "spki",
    });
  } catch {
    return false;
  }
  try {
    return verify(
      null,
      Buffer.from(canonicalizeAttestation(payload), "utf8"),
      publicKey,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}

export interface AttestationRecord {
  payload: AttestationPayload;
  /** Lowercase hex Ed25519 signature. */
  signature: string;
  /** Which key signed it — see {@link attestationKeyId}. */
  publicKeyId: string;
}

export interface ChainVerification {
  ok: boolean;
  errors: string[];
  /** Link value of the last attestation, when the chain verifies. */
  head?: string;
}

/**
 * Verify a document's whole attestation chain.
 *
 * Every check here is one an auditor would otherwise have to trust the database
 * for: that the sequence is contiguous from 1, that each link commits to the
 * one before it, that time never runs backwards, and that every signature holds
 * under a key the caller recognises. A gap, a swap, a back-date or an unknown
 * key is reported rather than ignored — a chain that "mostly" verifies is not a
 * chain.
 *
 * `publicKeysById` maps key id to SPKI DER hex, so rotation is just an extra
 * entry rather than a re-issue of history.
 */
export function verifyAttestationChain(
  records: readonly AttestationRecord[],
  publicKeysById: Readonly<Record<string, string>>,
): ChainVerification {
  const errors: string[] = [];
  if (records.length === 0) {
    return { ok: false, errors: ["Chain is empty."] };
  }

  const documentId = records[0]!.payload.documentId;
  let prev = GENESIS_PREV;
  let previousAt = -Infinity;

  records.forEach((record, index) => {
    const { payload } = record;
    const at = `sequence ${payload.sequence}`;

    if (payload.domain !== ATTESTATION_DOMAIN) {
      errors.push(`${at}: wrong domain "${payload.domain}".`);
    }
    if (payload.statement !== ATTESTATION_STATEMENT) {
      // The statement bounds what the signature means. A different one is a
      // different claim, even if everything else checks out.
      errors.push(`${at}: statement does not match this domain's statement.`);
    }
    if (payload.documentId !== documentId) {
      errors.push(
        `${at}: belongs to document "${payload.documentId}", not "${documentId}".`,
      );
    }
    if (payload.sequence !== index + 1) {
      errors.push(`${at}: expected sequence ${index + 1}.`);
    }
    if (!isSha256Hex(payload.contentHash)) {
      errors.push(`${at}: content hash is not a sha256 digest.`);
    }
    if (payload.prevAttestationHash !== prev) {
      errors.push(
        `${at}: does not link to the previous attestation — the history has ` +
          `been altered, reordered or truncated here.`,
      );
    }

    const attestedAt = Date.parse(payload.attestedAt);
    if (Number.isNaN(attestedAt)) {
      errors.push(`${at}: attestedAt is not a valid timestamp.`);
    } else {
      if (attestedAt < previousAt) {
        errors.push(`${at}: attested before the attestation that precedes it.`);
      }
      previousAt = attestedAt;
    }

    const publicKey = publicKeysById[record.publicKeyId];
    if (!publicKey) {
      errors.push(`${at}: signed by unknown key "${record.publicKeyId}".`);
    } else if (!verifyAttestation(payload, record.signature, publicKey)) {
      errors.push(`${at}: signature does not verify.`);
    }

    prev = attestationHash(payload);
  });

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, errors: [], head: prev };
}
