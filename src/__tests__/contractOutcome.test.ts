import { describe, expect, it } from "@jest/globals";

import {
  buildSignOffPayload,
  canonicalizeSignOffPayload,
  evaluateContractOutcome,
  evaluateThreshold,
} from "@/lib/documents/payload";

/**
 * The contract outcome rule, and why it cannot be `evaluateThreshold`.
 *
 * A threshold counts approvals anonymously. A contract is a set of named
 * obligations — so the two differ precisely where it matters: an optional
 * party's refusal must not sink the agreement, and a required party's refusal
 * must, no matter how many other signatures exist.
 */

const P = (id: string, required = true) => ({ id, required });
const R = (partyId: string | null, action: "approve" | "reject") => ({
  partyId,
  action,
});

describe("evaluateContractOutcome", () => {
  it("approves once every required party has approved", () => {
    expect(
      evaluateContractOutcome({
        parties: [P("buyer"), P("seller")],
        reviews: [R("buyer", "approve"), R("seller", "approve")],
      }),
    ).toBe("Approved");
  });

  it("stays in review while a required party has not acted", () => {
    expect(
      evaluateContractOutcome({
        parties: [P("buyer"), P("seller")],
        reviews: [R("buyer", "approve")],
      }),
    ).toBe("InReview");
  });

  it("is rejected the moment any required party rejects", () => {
    expect(
      evaluateContractOutcome({
        parties: [P("buyer"), P("seller")],
        reviews: [R("buyer", "approve"), R("seller", "reject")],
      }),
    ).toBe("Rejected");
  });

  it("ignores an optional party's refusal", () => {
    // The case a threshold cannot express. A Witness declining is not the
    // contract failing.
    expect(
      evaluateContractOutcome({
        parties: [P("buyer"), P("seller"), P("witness", false)],
        reviews: [
          R("buyer", "approve"),
          R("seller", "approve"),
          R("witness", "reject"),
        ],
      }),
    ).toBe("Approved");
  });

  it("does not let an optional party's approval stand in for a required one", () => {
    expect(
      evaluateContractOutcome({
        parties: [P("buyer"), P("seller"), P("witness", false)],
        reviews: [R("buyer", "approve"), R("witness", "approve")],
      }),
    ).toBe("InReview");
  });

  it("completes without the optional party ever acting", () => {
    expect(
      evaluateContractOutcome({
        parties: [P("buyer"), P("witness", false)],
        reviews: [R("buyer", "approve")],
      }),
    ).toBe("Approved");
  });

  it("refuses to call a party set with nothing required decided", () => {
    // "Every required party approved" is vacuously true over an empty set, and
    // approving a contract nobody had to sign is the worst possible default.
    expect(
      evaluateContractOutcome({
        parties: [P("witness", false)],
        reviews: [R("witness", "approve")],
      }),
    ).toBe("InReview");
    expect(evaluateContractOutcome({ parties: [], reviews: [] })).toBe(
      "InReview",
    );
  });

  it("ignores reviews that carry no party", () => {
    expect(
      evaluateContractOutcome({
        parties: [P("buyer")],
        reviews: [R(null, "approve")],
      }),
    ).toBe("InReview");
  });

  it("counts one human holding two roles as two obligations", () => {
    // Both parties may resolve to the same wallet address; the rule never sees
    // addresses, only capacities, which is what makes dual roles safe.
    expect(
      evaluateContractOutcome({
        parties: [P("tenant"), P("guarantor")],
        reviews: [R("tenant", "approve")],
      }),
    ).toBe("InReview");
    expect(
      evaluateContractOutcome({
        parties: [P("tenant"), P("guarantor")],
        reviews: [R("tenant", "approve"), R("guarantor", "approve")],
      }),
    ).toBe("Approved");
  });

  it("differs from evaluateThreshold on the case that matters", () => {
    // Same facts, both rules. Two approvals out of three signers with a
    // required party having rejected: the anonymous count says Approved.
    expect(
      evaluateThreshold({
        approvals: 2,
        rejections: 1,
        signerCount: 3,
        requiredSigners: 2,
      }),
    ).toBe("Approved");

    expect(
      evaluateContractOutcome({
        parties: [P("buyer"), P("seller"), P("witness", false)],
        reviews: [
          R("buyer", "approve"),
          R("witness", "approve"),
          R("seller", "reject"),
        ],
      }),
    ).toBe("Rejected");
  });
});

describe("partyId in the signed bytes", () => {
  const base = {
    action: "approve" as const,
    contentHash: "a".repeat(64),
    documentId: "d",
    signedAt: "2026-01-01T00:00:00.000Z",
    signerAddress: "addr",
    versionId: "v",
    versionNumber: 1,
    walletId: "w",
    walletPolicyHash: "p",
  };

  it("leaves threshold bytes byte-identical to before contracts existed", () => {
    // The reason this needs no SIGNOFF_DOMAIN bump: canonicalize drops
    // undefined keys, so every proof already issued keeps verifying.
    const threshold = canonicalizeSignOffPayload(buildSignOffPayload(base));
    expect(threshold).not.toContain("partyId");
    expect(
      canonicalizeSignOffPayload(
        buildSignOffPayload({ ...base, partyId: null }),
      ),
    ).toBe(threshold);
  });

  it("binds the capacity when there is one", () => {
    const parties = canonicalizeSignOffPayload(
      buildSignOffPayload({ ...base, partyId: "cp_buyer" }),
    );
    expect(parties).toContain('"partyId":"cp_buyer"');
    // Sorted like every other key — canonical form is not insertion order.
    expect(parties.indexOf('"documentId"')).toBeLessThan(
      parties.indexOf('"partyId"'),
    );
  });

  it("gives two roles of one human different bytes to sign", () => {
    const asTenant = canonicalizeSignOffPayload(
      buildSignOffPayload({ ...base, partyId: "cp_tenant" }),
    );
    const asGuarantor = canonicalizeSignOffPayload(
      buildSignOffPayload({ ...base, partyId: "cp_guarantor" }),
    );
    // Same address, same version, same action — and not interchangeable. This
    // is what stops one signature counting twice.
    expect(asTenant).not.toBe(asGuarantor);
  });
});
