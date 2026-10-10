/**
 * The PDF half of the sign-off proof export (PRD-001).
 *
 * A PDF is easy to get subtly wrong in ways no assertion about "did it throw"
 * would catch: a byte offset in the cross-reference table that points at the
 * wrong object, or a /Length that disagrees with the stream it describes, and
 * the file opens in one reader and fails in another. So these tests parse the
 * bytes back out and check the structural invariants a reader relies on, plus
 * the one property that makes a proof artifact worth anything — that the
 * evidence in the package actually reached the page.
 */

import { describe, expect, it } from "@jest/globals";

import {
  buildProofPdf,
  proofPdfFileName,
  toWinAnsi,
} from "@/lib/documents/proof-pdf";
import {
  PROOF_FORMAT,
  VERIFICATION_INSTRUCTIONS,
  type ProofPackage,
  type ProofReview,
} from "@/lib/documents/proof";

const CONTENT_HASH =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const POLICY_HASH =
  "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b";
/** Long enough to wrap, like the real thing. */
const SIGNATURE = "84584da3012704".repeat(40);

function makeReview(overrides: Partial<ProofReview> = {}): ProofReview {
  return {
    signerAddress: "addr_test1qzsigneraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    signerDescription: "Alice",
    action: "approve",
    comment: "Matches the board minutes.",
    payload: `{"action":"approve","contentHash":"${CONTENT_HASH}","documentId":"doc_1"}`,
    signature: SIGNATURE,
    signatureKey: "a4010103272006215820" + "ab".repeat(32),
    signedAt: "2026-08-05T09:00:00.000Z",
    ...overrides,
  };
}

function makeProof(overrides: Partial<ProofPackage> = {}): ProofPackage {
  return {
    format: PROOF_FORMAT,
    exportedAt: "2026-08-05T10:00:00.000Z",
    document: {
      id: "doc_1",
      walletId: "wallet_1",
      title: "Q3 Treasury Budget",
      description: "The quarterly allocation, for signature.",
      documentType: "budget",
      createdBy: "addr_test1qzcreator",
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    version: {
      id: "ver_1",
      versionNumber: 2,
      contentHash: CONTENT_HASH,
      hashAlgorithm: "sha256",
      fileName: "budget.pdf",
      mimeType: "application/pdf",
      fileSize: 20480,
      status: "Approved",
      createdBy: "addr_test1qzcreator",
      createdAt: "2026-08-02T00:00:00.000Z",
      reviewStartedAt: "2026-08-03T00:00:00.000Z",
      decidedAt: "2026-08-05T09:00:00.000Z",
    },
    policy: {
      walletId: "wallet_1",
      walletPolicyHash: POLICY_HASH,
      requiredSigners: 2,
      signersAddresses: [
        "addr_test1qzsigneraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "addr_test1qzsignerbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "addr_test1qzsignerccccccccccccccccccccccccccccccccccccccc",
      ],
      signersDescriptions: ["Alice", "Bob", "Carol"],
      capturedAt: "2026-08-03T00:00:00.000Z",
    },
    reviews: [makeReview()],
    events: [
      {
        type: "document.created",
        actorAddress: "addr_test1qzcreator",
        createdAt: "2026-08-01T00:00:00.000Z",
        metadata: null,
      },
      {
        type: "review.started",
        actorAddress: "addr_test1qzcreator",
        createdAt: "2026-08-03T00:00:00.000Z",
        metadata: null,
      },
    ],
    verification: {
      domain: "mesh-multisig.document-signoff.v1",
      instructions: VERIFICATION_INSTRUCTIONS,
    },
    ...overrides,
  };
}

/** The bytes as a string where one character is one byte, as the file is written. */
function asLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

/** Every string the content streams actually draw, in order. */
function drawnText(pdf: string): string[] {
  return [...pdf.matchAll(/\((.*?)\) Tj/g)].map((m) =>
    (m[1] ?? "").replace(/\\([\\()])/g, "$1"),
  );
}

describe("buildProofPdf", () => {
  it("writes a file a reader can parse: header, xref, trailer", () => {
    const pdf = asLatin1(buildProofPdf(makeProof()));

    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.endsWith("%%EOF\n")).toBe(true);

    const startxref = /startxref\n(\d+)\n%%EOF/.exec(pdf);
    expect(startxref).not.toBeNull();
    const xrefOffset = Number(startxref![1]);
    expect(pdf.slice(xrefOffset, xrefOffset + 4)).toBe("xref");

    expect(pdf).toContain("/Type /Catalog");
    expect(pdf).toContain("/Root 1 0 R");
  });

  it("points every cross-reference entry at the object it claims", () => {
    const pdf = asLatin1(buildProofPdf(makeProof()));
    const xrefOffset = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);
    const table = pdf.slice(xrefOffset);

    const header = /^xref\n0 (\d+)\n/.exec(table);
    expect(header).not.toBeNull();
    const count = Number(header![1]);

    const entries = [...table.matchAll(/^(\d{10}) \d{5} [nf] $/gm)];
    expect(entries).toHaveLength(count);

    // Entry 0 is the free head; 1..n must each land on "<n> 0 obj".
    entries.slice(1).forEach((entry, index) => {
      const offset = Number(entry[1]);
      expect(pdf.startsWith(`${index + 1} 0 obj`, offset)).toBe(true);
    });
  });

  it("declares a /Length that matches the stream it describes", () => {
    const pdf = asLatin1(buildProofPdf(makeProof()));
    const streams = [
      ...pdf.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g),
    ];

    expect(streams.length).toBeGreaterThan(0);
    for (const [, declared, body] of streams) {
      expect(body!.length).toBe(Number(declared));
    }
  });

  it("counts its pages the same way in /Count, /Kids and the page objects", () => {
    // Enough signatures, each carrying a wrapping signature, to overflow a page.
    const proof = makeProof({
      reviews: [
        makeReview({ signerDescription: "Alice" }),
        makeReview({ signerDescription: "Bob", action: "reject" }),
        makeReview({ signerDescription: "Carol" }),
      ],
    });
    const pdf = asLatin1(buildProofPdf(proof));

    const count = Number(/\/Type \/Pages \/Kids \[(.*?)\] \/Count (\d+)/.exec(pdf)![2]);
    const kids = /\/Kids \[(.*?)\]/.exec(pdf)![1]!.trim().split(" 0 R").filter(Boolean);
    const pageObjects = [...pdf.matchAll(/\/Type \/Page /g)];

    expect(count).toBeGreaterThan(1);
    expect(kids).toHaveLength(count);
    expect(pageObjects).toHaveLength(count);
    expect(pdf).toContain(`Page ${count} of ${count}`);
  });

  it("carries the evidence: hash, signers, signature and instructions", () => {
    const proof = makeProof();
    const drawn = drawnText(asLatin1(buildProofPdf(proof)));
    const joined = drawn.join("");

    // The hash fits one line, so it must survive verbatim.
    expect(drawn).toContain(CONTENT_HASH);
    expect(drawn).toContain(POLICY_HASH);
    // The signature wraps, so it is only whole once the lines are rejoined.
    expect(joined).toContain(SIGNATURE);
    for (const address of proof.policy.signersAddresses) {
      expect(drawn).toContain(address);
    }
    expect(joined).toContain(proof.reviews[0]!.payload);
    expect(joined).toContain("2 of 3 signers");
    // The disclaimer that keeps this an attestation rather than a signature.
    expect(joined).toContain("not a qualified electronic signature");
  });

  it("says the JSON is the authoritative artifact, and where to check it", () => {
    const joined = drawnText(
      asLatin1(
        buildProofPdf(makeProof(), {
          verifyUrl: "https://multisig.meshjs.dev/verify",
        }),
      ),
    ).join(" ");

    expect(joined).toContain("authoritative");
    expect(joined).toContain("https://multisig.meshjs.dev/verify");
  });

  it("prints a verification result when one is supplied, including a failure", () => {
    const failed = drawnText(
      asLatin1(
        buildProofPdf(makeProof(), {
          verification: {
            valid: false,
            format: PROOF_FORMAT,
            contentHashMatches: false,
            approvals: 1,
            rejections: 0,
            requiredSigners: 2,
            thresholdReached: false,
            reviews: [],
            errors: ["The supplied document does not hash to the approved content hash"],
          },
        }),
      ),
    ).join(" ");

    expect(failed).toContain("did NOT verify");
    expect(failed).toContain("does NOT hash to the approved content hash");
  });

  it("is deterministic — the same package always produces the same bytes", () => {
    const first = buildProofPdf(makeProof());
    const second = buildProofPdf(makeProof());
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });

  it("survives text the base-14 fonts cannot encode", () => {
    const proof = makeProof({
      document: {
        ...makeProof().document,
        // Latin-1 must survive; the emoji cannot, and must not corrupt the file.
        title: "Übergabe – Q3 💸",
      },
    });
    const bytes = buildProofPdf(proof);
    const pdf = asLatin1(bytes);

    expect(drawnText(pdf).join(" ")).toContain("Übergabe - Q3 ?");
    // Every byte is a byte: the declared stream lengths still hold.
    for (const [, declared, body] of pdf.matchAll(
      /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g,
    )) {
      expect(body!.length).toBe(Number(declared));
    }
    expect(bytes.every((b) => b <= 0xff)).toBe(true);
  });

  it("escapes the delimiters that would otherwise end a PDF string early", () => {
    const proof = makeProof({
      reviews: [makeReview({ comment: "Approved (with a caveat) \\ see annex" })],
    });
    const pdf = asLatin1(buildProofPdf(proof));

    expect(pdf).toContain("\\(with a caveat\\)");
    expect(drawnText(pdf).join(" ")).toContain(
      "Approved (with a caveat) \\ see annex",
    );
  });

  it("names the file the way the JSON export does", () => {
    expect(proofPdfFileName(makeProof())).toBe("signoff-proof-doc_1-v2.pdf");
  });
});

describe("toWinAnsi", () => {
  it("keeps Latin-1, folds typographic punctuation, replaces the rest", () => {
    expect(toWinAnsi("Grüße")).toBe("Grüße");
    expect(toWinAnsi("“quoted” — done…")).toBe(
      '"quoted" - done...',
    );
    expect(toWinAnsi("日本語")).toBe("???");
  });

  it("flattens newlines and tabs, which would break a PDF string", () => {
    expect(toWinAnsi("one\ntwo\tthree")).toBe("one two three");
  });
});
