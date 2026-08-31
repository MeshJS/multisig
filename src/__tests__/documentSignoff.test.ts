/**
 * Document Sign-Off (PRD-001) — payload binding, threshold, and proof verification.
 *
 * These cover the two rules the feature stands on: a signature is bound to one
 * exact document version, and the threshold comes from the frozen signer
 * snapshot. Both are enforced server-side, so both are tested server-side.
 */

import {
  SIGNOFF_DOMAIN,
  SIGNOFF_STATEMENTS,
  buildSignOffPayload,
  canonicalize,
  canonicalizeSignOffPayload,
  evaluateThreshold,
  isSha256Hex,
  isSignedAtWithinTolerance,
  sha256Hex,
  walletPolicyHash,
} from "@/lib/documents/payload";
import {
  PROOF_FORMAT,
  VERIFICATION_INSTRUCTIONS,
  verifyProofPackage,
  type ProofPackage,
  type ProofReview,
} from "@/lib/documents/proof";

const SIGNER_A = "addr_test1_signer_a";
const SIGNER_B = "addr_test1_signer_b";
const SIGNER_C = "addr_test1_signer_c";
const OUTSIDER = "addr_test1_outsider";

const CONTENT_HASH = sha256Hex("the budget, version 1");
const OTHER_HASH = sha256Hex("the budget, version 2");
const POLICY_HASH = walletPolicyHash("8200581c-script-cbor");
const SIGNED_AT = "2026-08-05T09:00:00.000Z";

/** Accepts anything — isolates the non-signature checks. */
const acceptAll = async () => true;
const rejectAll = async () => false;

function makeReview(
  signerAddress: string,
  action: "approve" | "reject" = "approve",
  overrides: Partial<{ contentHash: string; versionId: string; comment: string }> = {},
): ProofReview {
  const payload = buildSignOffPayload({
    action,
    comment: overrides.comment,
    contentHash: overrides.contentHash ?? CONTENT_HASH,
    documentId: "doc_1",
    signedAt: SIGNED_AT,
    signerAddress,
    versionId: overrides.versionId ?? "ver_1",
    versionNumber: 1,
    walletId: "wallet_1",
    walletPolicyHash: POLICY_HASH,
  });
  return {
    signerAddress,
    action,
    comment: overrides.comment ?? null,
    payload: canonicalizeSignOffPayload(payload),
    signature: "cose_sign1_hex",
    signatureKey: "cose_key_hex",
    signedAt: SIGNED_AT,
  };
}

function makeProof(reviews: ProofReview[], requiredSigners = 2): ProofPackage {
  return {
    format: PROOF_FORMAT,
    exportedAt: "2026-08-05T10:00:00.000Z",
    document: {
      id: "doc_1",
      walletId: "wallet_1",
      title: "Q3 Treasury Budget",
      description: null,
      documentType: null,
      createdBy: SIGNER_A,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    version: {
      id: "ver_1",
      versionNumber: 1,
      contentHash: CONTENT_HASH,
      hashAlgorithm: "sha256",
      fileName: "budget.pdf",
      mimeType: "application/pdf",
      fileSize: 1024,
      status: "Approved",
      createdBy: SIGNER_A,
      createdAt: "2026-08-01T00:00:00.000Z",
      reviewStartedAt: "2026-08-02T00:00:00.000Z",
      decidedAt: "2026-08-05T09:00:00.000Z",
    },
    policy: {
      walletId: "wallet_1",
      walletPolicyHash: POLICY_HASH,
      requiredSigners,
      signersAddresses: [SIGNER_A, SIGNER_B, SIGNER_C],
      signersDescriptions: ["Alice", "Bob", "Carol"],
      capturedAt: "2026-08-02T00:00:00.000Z",
    },
    reviews,
    events: [],
    verification: {
      domain: SIGNOFF_DOMAIN,
      instructions: VERIFICATION_INSTRUCTIONS,
    },
  };
}

// ---------------------------------------------------------------------------

describe("canonicalization", () => {
  it("is independent of key insertion order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("produces no incidental whitespace", () => {
    expect(canonicalize({ a: 1, b: "x" })).toBe('{"a":1,"b":"x"}');
  });

  it("drops undefined but keeps null", () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("recurses into nested objects and arrays", () => {
    expect(canonicalize({ z: [{ b: 1, a: 2 }] })).toBe('{"z":[{"a":2,"b":1}]}');
  });
});

describe("buildSignOffPayload", () => {
  it("carries the plain-language statement that matches the action", () => {
    const approve = buildSignOffPayload({
      action: "approve",
      contentHash: CONTENT_HASH,
      documentId: "doc_1",
      signedAt: SIGNED_AT,
      signerAddress: SIGNER_A,
      versionId: "ver_1",
      versionNumber: 1,
      walletId: "wallet_1",
      walletPolicyHash: POLICY_HASH,
    });
    expect(approve.statement).toBe(SIGNOFF_STATEMENTS.approve);
    expect(approve.statement).toMatch(/I approve this exact document version/);
    expect(approve.domain).toBe(SIGNOFF_DOMAIN);
  });

  it("always includes comment, so an empty comment is still signed", () => {
    const payload = buildSignOffPayload({
      action: "reject",
      contentHash: CONTENT_HASH,
      documentId: "doc_1",
      signedAt: SIGNED_AT,
      signerAddress: SIGNER_A,
      versionId: "ver_1",
      versionNumber: 1,
      walletId: "wallet_1",
      walletPolicyHash: POLICY_HASH,
    });
    expect(payload.comment).toBe("");
    expect(canonicalizeSignOffPayload(payload)).toContain('"comment":""');
  });

  it("rejects an unparseable signedAt rather than silently stamping now()", () => {
    expect(() =>
      buildSignOffPayload({
        action: "approve",
        contentHash: CONTENT_HASH,
        documentId: "doc_1",
        signedAt: "not-a-date",
        signerAddress: SIGNER_A,
        versionId: "ver_1",
        versionNumber: 1,
        walletId: "wallet_1",
        walletPolicyHash: POLICY_HASH,
      }),
    ).toThrow(/not a valid date/i);
  });
});

describe("version-hash binding", () => {
  const base = {
    action: "approve" as const,
    documentId: "doc_1",
    signedAt: SIGNED_AT,
    signerAddress: SIGNER_A,
    versionNumber: 1,
    walletId: "wallet_1",
    walletPolicyHash: POLICY_HASH,
  };

  it("produces a different payload for a different content hash", () => {
    const v1 = canonicalizeSignOffPayload(
      buildSignOffPayload({ ...base, contentHash: CONTENT_HASH, versionId: "ver_1" }),
    );
    const v2 = canonicalizeSignOffPayload(
      buildSignOffPayload({ ...base, contentHash: OTHER_HASH, versionId: "ver_1" }),
    );
    expect(v1).not.toBe(v2);
  });

  it("produces a different payload for a different version id", () => {
    const v1 = canonicalizeSignOffPayload(
      buildSignOffPayload({ ...base, contentHash: CONTENT_HASH, versionId: "ver_1" }),
    );
    const v2 = canonicalizeSignOffPayload(
      buildSignOffPayload({ ...base, contentHash: CONTENT_HASH, versionId: "ver_2" }),
    );
    expect(v1).not.toBe(v2);
  });

  it("a tampered comment changes the payload, so the signature no longer matches", () => {
    const clean = canonicalizeSignOffPayload(
      buildSignOffPayload({ ...base, contentHash: CONTENT_HASH, versionId: "ver_1" }),
    );
    const tampered = canonicalizeSignOffPayload(
      buildSignOffPayload({
        ...base,
        contentHash: CONTENT_HASH,
        versionId: "ver_1",
        comment: "actually I meant no",
      }),
    );
    expect(clean).not.toBe(tampered);
  });

  it("rebuilding from identical inputs is byte-identical — the server-side check", () => {
    const input = { ...base, contentHash: CONTENT_HASH, versionId: "ver_1" };
    expect(canonicalizeSignOffPayload(buildSignOffPayload(input))).toBe(
      canonicalizeSignOffPayload(buildSignOffPayload(input)),
    );
  });
});

describe("hash + time helpers", () => {
  it("recognises a sha256 digest and rejects near-misses", () => {
    expect(isSha256Hex(CONTENT_HASH)).toBe(true);
    expect(isSha256Hex(CONTENT_HASH.toUpperCase())).toBe(false);
    expect(isSha256Hex(CONTENT_HASH.slice(0, 63))).toBe(false);
    expect(isSha256Hex("")).toBe(false);
  });

  it("accepts a signedAt inside the window and rejects one outside it", () => {
    const now = new Date("2026-08-05T09:00:00.000Z");
    expect(isSignedAtWithinTolerance("2026-08-05T09:05:00.000Z", now)).toBe(true);
    expect(isSignedAtWithinTolerance("2026-08-05T08:45:00.000Z", now)).toBe(false);
    expect(isSignedAtWithinTolerance("nonsense", now)).toBe(false);
  });
});

describe("evaluateThreshold", () => {
  it("approves once the threshold is met", () => {
    expect(
      evaluateThreshold({ approvals: 2, rejections: 0, signerCount: 3, requiredSigners: 2 }),
    ).toBe("Approved");
  });

  it("stays open while the threshold is still reachable", () => {
    expect(
      evaluateThreshold({ approvals: 1, rejections: 1, signerCount: 3, requiredSigners: 2 }),
    ).toBe("InReview");
  });

  it("rejects as soon as the threshold has become unreachable", () => {
    expect(
      evaluateThreshold({ approvals: 1, rejections: 2, signerCount: 3, requiredSigners: 2 }),
    ).toBe("Rejected");
  });

  it("handles unanimous policies", () => {
    expect(
      evaluateThreshold({ approvals: 2, rejections: 1, signerCount: 3, requiredSigners: 3 }),
    ).toBe("Rejected");
    expect(
      evaluateThreshold({ approvals: 3, rejections: 0, signerCount: 3, requiredSigners: 3 }),
    ).toBe("Approved");
  });
});

describe("verifyProofPackage", () => {
  it("accepts a well-formed, fully signed, threshold-reaching package", async () => {
    const proof = makeProof([makeReview(SIGNER_A), makeReview(SIGNER_B)]);
    const result = await verifyProofPackage(proof, { checkSignature: acceptAll });
    expect(result.valid).toBe(true);
    expect(result.approvals).toBe(2);
    expect(result.thresholdReached).toBe(true);
    expect(result.reviews.every((r) => r.valid)).toBe(true);
  });

  it("confirms a re-hashed document against the approved content hash", async () => {
    const proof = makeProof([makeReview(SIGNER_A), makeReview(SIGNER_B)]);
    const ok = await verifyProofPackage(proof, {
      checkSignature: acceptAll,
      expectedContentHash: CONTENT_HASH,
    });
    expect(ok.contentHashMatches).toBe(true);
    expect(ok.valid).toBe(true);

    const wrong = await verifyProofPackage(proof, {
      checkSignature: acceptAll,
      expectedContentHash: OTHER_HASH,
    });
    expect(wrong.contentHashMatches).toBe(false);
    expect(wrong.valid).toBe(false);
    expect(wrong.errors.join(" ")).toMatch(/does not hash to the approved content hash/i);
  });

  it("fails when a signature does not verify", async () => {
    const proof = makeProof([makeReview(SIGNER_A), makeReview(SIGNER_B)]);
    const result = await verifyProofPackage(proof, { checkSignature: rejectAll });
    expect(result.valid).toBe(false);
    expect(result.approvals).toBe(0);
    expect(result.reviews[0]?.signatureValid).toBe(false);
  });

  it("fails when a review's payload names a different version's hash", async () => {
    const proof = makeProof([
      makeReview(SIGNER_A),
      makeReview(SIGNER_B, "approve", { contentHash: OTHER_HASH }),
    ]);
    const result = await verifyProofPackage(proof, { checkSignature: acceptAll });
    expect(result.valid).toBe(false);
    expect(result.reviews[1]?.payloadBindsToVersion).toBe(false);
    expect(result.reviews[1]?.errors.join(" ")).toMatch(/payload\.contentHash/);
  });

  it("rejects a signer who is not in the frozen snapshot", async () => {
    const proof = makeProof([makeReview(SIGNER_A), makeReview(OUTSIDER)]);
    const result = await verifyProofPackage(proof, { checkSignature: acceptAll });
    expect(result.valid).toBe(false);
    expect(result.reviews[1]?.signerInSnapshot).toBe(false);
    expect(result.approvals).toBe(1);
  });

  it("rejects a duplicated signer rather than counting them twice", async () => {
    const proof = makeProof([makeReview(SIGNER_A), makeReview(SIGNER_A)]);
    const result = await verifyProofPackage(proof, { checkSignature: acceptAll });
    expect(result.valid).toBe(false);
    expect(result.reviews[1]?.errors.join(" ")).toMatch(/duplicate/i);
    expect(result.approvals).toBe(1);
  });

  it("rejects a payload that is not in canonical form", async () => {
    const review = makeReview(SIGNER_A);
    const reordered = JSON.stringify(JSON.parse(review.payload), null, 2);
    const proof = makeProof([{ ...review, payload: reordered }, makeReview(SIGNER_B)]);
    const result = await verifyProofPackage(proof, { checkSignature: acceptAll });
    expect(result.valid).toBe(false);
    expect(result.reviews[0]?.errors.join(" ")).toMatch(/canonical/i);
  });

  it("reports not-yet-approved when the threshold is unmet", async () => {
    const proof = makeProof([makeReview(SIGNER_A)]);
    const result = await verifyProofPackage(proof, { checkSignature: acceptAll });
    expect(result.thresholdReached).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.approvals).toBe(1);
    expect(result.requiredSigners).toBe(2);
  });

  it("counts rejections separately and does not credit them as approvals", async () => {
    const proof = makeProof([
      makeReview(SIGNER_A, "approve"),
      makeReview(SIGNER_B, "reject"),
    ]);
    const result = await verifyProofPackage(proof, { checkSignature: acceptAll });
    expect(result.approvals).toBe(1);
    expect(result.rejections).toBe(1);
    expect(result.thresholdReached).toBe(false);
  });

  it("flags an unknown proof format", async () => {
    const proof = { ...makeProof([makeReview(SIGNER_A)]), format: "something-else" } as unknown as ProofPackage;
    const result = await verifyProofPackage(proof, { checkSignature: acceptAll });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/unknown proof format/i);
  });

  it("survives a signature checker that throws", async () => {
    const proof = makeProof([makeReview(SIGNER_A), makeReview(SIGNER_B)]);
    const result = await verifyProofPackage(proof, {
      checkSignature: async () => {
        throw new Error("cbor decode failed");
      },
    });
    expect(result.valid).toBe(false);
    expect(result.reviews[0]?.errors.join(" ")).toMatch(/cbor decode failed/);
  });
});
