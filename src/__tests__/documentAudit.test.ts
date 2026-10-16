import { generateKeyPairSync } from "crypto";
import { describe, expect, it } from "@jest/globals";

import {
  AUDIT_FORMAT,
  auditPackageProblem,
  buildAuditPackage,
  verifyAuditPackage,
  versionLineage,
  type AuditPackage,
  type AuditSourceAttestation,
  type AuditSourceEvent,
  type AuditSourceVersion,
} from "@/lib/documents/audit";
import {
  GENESIS_PREV,
  attestationHash,
  attestationKeyId,
  buildAttestationPayload,
  canonicalizeAttestation,
  signAttestation,
} from "@/lib/documents/attestation";
import {
  buildSignOffPayload,
  canonicalizeSignOffPayload,
  sha256Hex,
} from "@/lib/documents/payload";
import { PROOF_FORMAT, type CheckSignatureFn } from "@/lib/documents/proof";

/**
 * Revision Provenance — the audit export.
 *
 * The bundle is only worth exporting if tampering with any part of it is
 * caught offline, so most of these tests alter an honest package one way at a
 * time and assert the verifier notices. CIP-8 itself is covered by the proof
 * tests; here it is injected, as the module intends.
 */

const acceptAll: CheckSignatureFn = async () => true;
const rejectAll: CheckSignatureFn = async () => false;

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const SPKI = publicKey.export({ type: "spki", format: "der" }).toString("hex");
const KEY_ID = attestationKeyId(SPKI);
const KEYS = { [KEY_ID]: SPKI };

const DOC_ID = "doc_1";
const WALLET_ID = "wallet_1";
const POLICY = "f".repeat(64);
const SIGNERS = ["addr_alice", "addr_bob", "addr_carol"];
const T0 = Date.UTC(2026, 8, 1, 9);
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

const HASH = {
  v1: sha256Hex("draft one"),
  v2: sha256Hex("draft two"),
};

const document = {
  id: DOC_ID,
  walletId: WALLET_ID,
  title: "Supply agreement",
  description: null,
  documentType: "Legal",
  createdBy: SIGNERS[0]!,
  createdAt: at(0),
  status: "InReview",
  signingMode: "threshold",
  archivedAt: null,
};

function review(
  versionId: string,
  versionNumber: number,
  contentHash: string,
  signer: string,
  minute: number,
) {
  const payload = buildSignOffPayload({
    action: "approve",
    contentHash,
    documentId: DOC_ID,
    signedAt: at(minute),
    signerAddress: signer,
    versionId,
    versionNumber,
    walletId: WALLET_ID,
    walletPolicyHash: POLICY,
  });
  return {
    signerAddress: signer,
    partyId: null,
    party: null,
    action: "approve" as const,
    comment: null,
    payload: canonicalizeSignOffPayload(payload),
    signature: "sig",
    signatureKey: "key",
    signedAt: at(minute),
  };
}

function version(
  id: string,
  versionNumber: number,
  contentHash: string,
  status: string,
  reviews: ReturnType<typeof review>[] | null,
): AuditSourceVersion {
  return {
    id,
    versionNumber,
    contentHash,
    hashAlgorithm: "sha256",
    fileName: "supply.md",
    mimeType: "text/markdown",
    fileSize: 9,
    status,
    createdBy: SIGNERS[0]!,
    createdAt: at(versionNumber * 10),
    reviewStartedAt: reviews ? at(versionNumber * 10 + 1) : null,
    decidedAt: status === "Approved" ? at(versionNumber * 10 + 5) : null,
    storageMode: "hashOnly",
    contentRef: null,
    reviewInstructions: null,
    supersededAt: null,
    signerSnapshot: reviews
      ? {
          walletId: WALLET_ID,
          walletPolicyHash: POLICY,
          requiredSigners: 2,
          signersAddresses: SIGNERS,
          signersDescriptions: ["Alice", "Bob", "Carol"],
          capturedAt: at(versionNumber * 10 + 1),
        }
      : null,
    reviews: reviews ?? [],
  };
}

function attest(
  versions: readonly AuditSourceVersion[],
): AuditSourceAttestation[] {
  let prev = GENESIS_PREV;
  return versions.map((v, i) => {
    const payload = buildAttestationPayload({
      attestedAt: v.createdAt,
      contentHash: v.contentHash,
      documentId: DOC_ID,
      prevAttestationHash: prev,
      sequence: i + 1,
      versionId: v.id,
      versionNumber: v.versionNumber,
      walletId: WALLET_ID,
    });
    prev = attestationHash(payload);
    return {
      versionId: v.id,
      sequence: i + 1,
      payload: canonicalizeAttestation(payload),
      signature: signAttestation(payload, privateKey),
      publicKeyId: KEY_ID,
    };
  });
}

/**
 * v1 approved 2-of-3, v2 uploaded and abandoned, v3 restores v1's content and
 * is back in review with one approval.
 */
function honestSource() {
  const v1 = version("ver_1", 1, HASH.v1, "Superseded", [
    review("ver_1", 1, HASH.v1, SIGNERS[0]!, 12),
    review("ver_1", 1, HASH.v1, SIGNERS[1]!, 13),
  ]);
  const v2 = version("ver_2", 2, HASH.v2, "Superseded", null);
  const v3 = version("ver_3", 3, HASH.v1, "InReview", [
    review("ver_3", 3, HASH.v1, SIGNERS[2]!, 32),
  ]);
  const versions = [v1, v2, v3];
  const events: AuditSourceEvent[] = [
    {
      versionId: null,
      type: "document.created",
      actorAddress: SIGNERS[0]!,
      createdAt: at(0),
      metadata: {},
    },
    {
      versionId: "ver_1",
      type: "version.uploaded",
      actorAddress: SIGNERS[0]!,
      createdAt: at(10),
      metadata: { versionNumber: 1 },
    },
    {
      versionId: "ver_1",
      type: "review.started",
      actorAddress: SIGNERS[0]!,
      createdAt: at(11),
      metadata: { requiredSigners: 2, signerCount: 3 },
    },
    {
      versionId: "ver_1",
      type: "version.superseded",
      actorAddress: SIGNERS[0]!,
      createdAt: at(20),
      metadata: { versionNumber: 1 },
    },
    {
      versionId: "ver_2",
      type: "version.published",
      actorAddress: SIGNERS[0]!,
      createdAt: at(20),
      metadata: { versionNumber: 2 },
    },
    {
      versionId: "ver_2",
      type: "version.superseded",
      actorAddress: SIGNERS[1]!,
      createdAt: at(30),
      metadata: { versionNumber: 2 },
    },
    {
      versionId: "ver_3",
      type: "version.restored",
      actorAddress: SIGNERS[1]!,
      createdAt: at(30),
      metadata: {
        versionNumber: 3,
        restoredFromVersionNumber: 1,
        restoredFromVersionId: "ver_1",
      },
    },
    {
      versionId: "ver_3",
      type: "review.started",
      actorAddress: SIGNERS[1]!,
      createdAt: at(31),
      metadata: { requiredSigners: 2, signerCount: 3 },
    },
  ];
  return { versions, events, attestations: attest(versions) };
}

function honestPackage(): AuditPackage {
  const src = honestSource();
  return buildAuditPackage({
    document,
    ...src,
    publicKeys: KEYS,
    exportedAt: at(60),
  });
}

/** Deep copy, so a test can tamper without touching the next one's package. */
const clone = (pkg: AuditPackage): AuditPackage =>
  JSON.parse(JSON.stringify(pkg)) as AuditPackage;

describe("versionLineage", () => {
  it("tells a restore apart from an upload by its event, not its number", () => {
    const { versions, events } = honestSource();
    const lineage = versionLineage(versions, events);
    expect(lineage.get("ver_1")).toEqual({
      origin: "upload",
      supersedes: null,
      restoredFrom: null,
    });
    expect(lineage.get("ver_2")).toEqual({
      origin: "draft",
      supersedes: 1,
      restoredFrom: null,
    });
    expect(lineage.get("ver_3")).toEqual({
      origin: "restore",
      supersedes: 2,
      restoredFrom: 1,
    });
  });
});

describe("buildAuditPackage", () => {
  it("bundles every version, the whole log and the chain", () => {
    const pkg = honestPackage();
    expect(pkg.format).toBe(AUDIT_FORMAT);
    expect(pkg.versions.map((v) => v.version.versionNumber)).toEqual([1, 2, 3]);
    expect(pkg.versions.map((v) => v.attestationSequence)).toEqual([1, 2, 3]);
    expect(pkg.events).toHaveLength(8);
    expect(pkg.attestation?.chain).toHaveLength(3);
  });

  it("embeds a standalone proof.v1 for each version that had a round", () => {
    const pkg = honestPackage();
    expect(pkg.versions.map((v) => v.proof?.format ?? null)).toEqual([
      PROOF_FORMAT,
      null,
      PROOF_FORMAT,
    ]);
    // A version's proof carries only its own events plus document-level ones.
    const v3Events = pkg.versions[2]!.proof!.events.map((e) => e.type);
    expect(v3Events).toEqual([
      "document.created",
      "version.restored",
      "review.started",
    ]);
  });

  it("omits the chain when the deployment never attested", () => {
    const src = honestSource();
    const pkg = buildAuditPackage({
      document,
      ...src,
      attestations: [],
      publicKeys: {},
      exportedAt: at(60),
    });
    expect(pkg.attestation).toBeNull();
    expect(pkg.versions.every((v) => v.attestationSequence === null)).toBe(
      true,
    );
  });
});

describe("verifyAuditPackage", () => {
  it("accepts an honest package, against independently held keys", async () => {
    const result = await verifyAuditPackage(honestPackage(), {
      checkSignature: acceptAll,
      publicKeys: KEYS,
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.keysFromPackage).toBe(false);
    expect(result.chain?.ok).toBe(true);
    expect(
      result.versions.map((v) => [
        v.versionNumber,
        v.approvals,
        v.thresholdReached,
      ]),
    ).toEqual([
      [1, 2, true],
      [2, 0, false],
      [3, 1, false],
    ]);
  });

  it("says when it only had the package's own keys to go on", async () => {
    const result = await verifyAuditPackage(honestPackage(), {
      checkSignature: acceptAll,
    });
    expect(result.valid).toBe(true);
    expect(result.keysFromPackage).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/obtained independently/);
  });

  it("fails when a signature does not verify", async () => {
    const result = await verifyAuditPackage(honestPackage(), {
      checkSignature: rejectAll,
      publicKeys: KEYS,
    });
    expect(result.valid).toBe(false);
    expect(result.versions[0]!.signaturesValid).toBe(false);
  });

  it("catches a version dropped from the middle", async () => {
    const pkg = clone(honestPackage());
    pkg.versions.splice(1, 1);
    const result = await verifyAuditPackage(pkg, {
      checkSignature: acceptAll,
      publicKeys: KEYS,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/1\.\.N/);
  });

  it("catches a restore that does not carry the content it names", async () => {
    const pkg = clone(honestPackage());
    pkg.versions[2]!.lineage.restoredFrom = 2;
    const result = await verifyAuditPackage(pkg, {
      checkSignature: acceptAll,
      publicKeys: KEYS,
    });
    expect(result.valid).toBe(false);
    expect(result.versions[2]!.errors.join(" ")).toMatch(
      /does not carry its content hash/,
    );
  });

  it("catches a version whose hash was swapped after it was attested", async () => {
    const pkg = clone(honestPackage());
    pkg.versions[1]!.version.contentHash = "0".repeat(64);
    const result = await verifyAuditPackage(pkg, {
      checkSignature: acceptAll,
      publicKeys: KEYS,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/attests a different content hash/);
  });

  it("catches a version that claims Approved without the approvals", async () => {
    const pkg = clone(honestPackage());
    pkg.versions[2]!.version.status = "Approved";
    const result = await verifyAuditPackage(pkg, {
      checkSignature: acceptAll,
      publicKeys: KEYS,
    });
    expect(result.valid).toBe(false);
    expect(result.versions[2]!.errors.join(" ")).toMatch(
      /do not reach the threshold/,
    );
  });

  it("catches a re-signed chain when the verifier holds the real key", async () => {
    const pkg = clone(honestPackage());
    const forger = generateKeyPairSync("ed25519");
    const forgedSpki = forger.publicKey
      .export({ type: "spki", format: "der" })
      .toString("hex");
    const forgedId = attestationKeyId(forgedSpki);
    pkg.attestation!.publicKeys = { [forgedId]: forgedSpki };
    for (const record of pkg.attestation!.chain) {
      record.signature = signAttestation(record.payload, forger.privateKey);
      record.publicKeyId = forgedId;
    }
    // Internally consistent, so it passes on its own keys …
    const selfCheck = await verifyAuditPackage(pkg, {
      checkSignature: acceptAll,
    });
    expect(selfCheck.valid).toBe(true);
    // … and fails against the deployment's real one.
    const real = await verifyAuditPackage(pkg, {
      checkSignature: acceptAll,
      publicKeys: KEYS,
    });
    expect(real.valid).toBe(false);
    expect(real.chain?.errors.join(" ")).toMatch(/unknown key/);
  });

  it("warns, but passes, when attestation began part-way through", async () => {
    const src = honestSource();
    // Key configured after v1: the chain starts at v2 with sequence 1.
    const later = attest(src.versions.slice(1));
    const pkg = buildAuditPackage({
      document,
      ...src,
      attestations: later,
      publicKeys: KEYS,
      exportedAt: at(60),
    });
    const result = await verifyAuditPackage(pkg, {
      checkSignature: acceptAll,
      publicKeys: KEYS,
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.warnings.join(" ")).toMatch(
      /v1 predates the attestation chain/,
    );
  });

  it("errors when a version after the start of the chain is unattested", async () => {
    const src = honestSource();
    const gappy = attest([src.versions[0]!, src.versions[2]!]);
    const pkg = buildAuditPackage({
      document,
      ...src,
      attestations: gappy,
      publicKeys: KEYS,
      exportedAt: at(60),
    });
    const result = await verifyAuditPackage(pkg, {
      checkSignature: acceptAll,
      publicKeys: KEYS,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(
      /v2 is missing from the attestation chain/,
    );
  });
});

describe("verifyAuditPackage — records that are not signed", () => {
  const verify = (pkg: AuditPackage, extra = {}) =>
    verifyAuditPackage(pkg, {
      checkSignature: acceptAll,
      publicKeys: KEYS,
      ...extra,
    });

  it("catches a lowered threshold, even though no signature covers it", async () => {
    const pkg = clone(honestPackage());
    pkg.versions[2]!.version.status = "Approved";
    pkg.versions[2]!.proof!.policy.requiredSigners = 1;
    const result = await verify(pkg);
    expect(result.valid).toBe(false);
    expect(result.versions[2]!.errors.join(" ")).toMatch(
      /round started with 2/,
    );
  });

  it("surfaces proof-level errors, not just review errors", async () => {
    const pkg = clone(honestPackage());
    (pkg.versions[0]!.proof as { format: string }).format = "evil";
    const result = await verify(pkg);
    expect(result.valid).toBe(false);
    expect(result.versions[0]!.errors.join(" ")).toMatch(
      /proof: Unknown proof format/,
    );
  });

  it("catches a signed round stripped from a superseded version", async () => {
    const pkg = clone(honestPackage());
    pkg.versions[0]!.proof = null;
    const result = await verify(pkg);
    expect(result.valid).toBe(false);
    expect(result.versions[0]!.errors.join(" ")).toMatch(
      /no proof was included/,
    );
  });

  it("catches a restore relabelled as an upload", async () => {
    const pkg = clone(honestPackage());
    pkg.versions[2]!.lineage = {
      origin: "upload",
      supersedes: 2,
      restoredFrom: null,
    };
    const result = await verify(pkg);
    expect(result.valid).toBe(false);
    expect(result.versions[2]!.errors.join(" ")).toMatch(
      /does not match the event log/,
    );
  });

  it("refuses an emptied event log", async () => {
    const pkg = clone(honestPackage());
    pkg.events = [];
    const result = await verify(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/event log is empty/);
  });

  it("can require the chain, so stripping it cannot hide a swapped hash", async () => {
    const pkg = clone(honestPackage());
    pkg.attestation = null;
    pkg.versions[1]!.version.contentHash = "0".repeat(64);
    expect((await verify(pkg)).valid).toBe(true);
    const strict = await verify(pkg, { requireAttestation: true });
    expect(strict.valid).toBe(false);
    expect(strict.errors.join(" ")).toMatch(
      /expects the exporting deployment to attest/,
    );
  });
});

describe("auditPackageProblem", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const honest = () => clone(honestPackage()) as unknown as Record<string, any>;

  it("accepts an honest package", () => {
    expect(auditPackageProblem(honest())).toBeNull();
  });

  it("names what is wrong with malformed input instead of throwing", () => {
    const mutate = (fn: (p: ReturnType<typeof honest>) => void) => {
      const p = honest();
      fn(p);
      return p;
    };
    const cases: unknown[] = [
      null,
      { document: {}, versions: [{}] },
      mutate((p) => (p.versions[0] = null)),
      mutate((p) => delete p.versions[0].lineage),
      mutate((p) => delete p.versions[0].proof.policy),
      mutate((p) => (p.attestation.chain = "nope")),
      mutate((p) => (p.attestation.chain[0] = { signature: "x" })),
    ];
    for (const value of cases) {
      expect(typeof auditPackageProblem(value)).toBe("string");
    }
  });

  it("bounds the work a public caller can ask for", () => {
    const p = clone(honestPackage());
    const review = p.versions[0]!.proof!.reviews[0]!;
    p.versions[0]!.proof!.reviews = Array.from({ length: 201 }, () => review);
    expect(auditPackageProblem(p)).toMatch(/too long/);
  });
});
