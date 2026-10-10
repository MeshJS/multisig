import { describe, expect, it } from "@jest/globals";
import { blake2b } from "@noble/hashes/blake2b";

import {
  buildRationaleAnchor,
  buildRationaleDocument,
  serializeRationale,
} from "@/lib/server/rationaleAnchor";

/**
 * The anchor is only useful if a verifier can fetch the pinned document,
 * re-hash it, and get the hash recorded on-chain. Everything here defends that
 * one property.
 */

const blake256 = (s: string) =>
  Buffer.from(blake2b(Buffer.from(s, "utf8"), { dkLen: 32 })).toString("hex");

const base = {
  summary: "Voting No: the budget is unfunded.",
  rationaleStatement: "The proposal does not identify a funding source.",
};

describe("rationale document", () => {
  it("carries the CIP-100/136 context and declares its hash algorithm", () => {
    const doc = buildRationaleDocument(base) as Record<string, any>;
    expect(doc.hashAlgorithm).toBe("blake2b-256");
    expect(doc["@context"].CIP100).toContain("CIP-0100");
    expect(doc["@context"].CIP136).toContain("CIP-0136");
    expect(doc.body.summary).toBe(base.summary);
    expect(doc.body.rationaleStatement).toBe(base.rationaleStatement);
  });

  it("truncates the summary to the 300-char CIP-136 limit", () => {
    const doc = buildRationaleDocument({
      ...base,
      summary: "x".repeat(500),
    }) as Record<string, any>;
    expect(doc.body.summary).toHaveLength(300);
  });

  it("omits empty optional fields entirely", () => {
    // An empty string is still a key, and every key changes the hash.
    const doc = buildRationaleDocument({
      ...base,
      precedentDiscussion: "   ",
      conclusion: "",
      references: [{ label: "", uri: "" }],
    }) as Record<string, any>;
    expect(doc.body).not.toHaveProperty("precedentDiscussion");
    expect(doc.body).not.toHaveProperty("conclusion");
    expect(doc.body).not.toHaveProperty("references");
  });

  it("includes optional fields that carry content", () => {
    const doc = buildRationaleDocument({
      ...base,
      counterargumentDiscussion: "Some disagree.",
      references: [{ label: "Thread", uri: "https://forum.example/1" }],
    }) as Record<string, any>;
    expect(doc.body.counterargumentDiscussion).toBe("Some disagree.");
    expect(doc.body.references).toEqual([
      { "@type": "Other", label: "Thread", uri: "https://forum.example/1" },
    ]);
  });
});

describe("serialization and hashing", () => {
  it("serializes as two-space pretty JSON", () => {
    // Not cosmetic: hashDrepAnchor hashes JSON.stringify(doc, null, 2), so the
    // bytes pinned to IPFS must be exactly this form or the anchor will not
    // verify against the fetched document.
    const json = serializeRationale(buildRationaleDocument(base));
    expect(json).toContain('\n  "hashAlgorithm"');
    expect(json).toBe(JSON.stringify(JSON.parse(json), null, 2));
  });

  it("hashes exactly the bytes it returns for pinning", () => {
    const anchor = buildRationaleAnchor(
      base,
      (doc) => blake256(JSON.stringify(doc, null, 2)),
      "rationale-tx#0",
    );
    // The invariant a verifier depends on.
    expect(anchor.hash).toBe(blake256(anchor.json));
  });

  it("is deterministic for identical input", () => {
    const mk = () =>
      buildRationaleAnchor(base, (d) => blake256(JSON.stringify(d, null, 2)), "f");
    expect(mk().hash).toBe(mk().hash);
  });

  it("changes the hash when the rationale changes", () => {
    const h = (input: typeof base) =>
      buildRationaleAnchor(input, (d) => blake256(JSON.stringify(d, null, 2)), "f").hash;
    expect(h(base)).not.toBe(h({ ...base, rationaleStatement: "Different." }));
  });

  it("sanitises the filename and keeps a .jsonld extension", () => {
    const anchor = buildRationaleAnchor(
      base,
      () => "deadbeef",
      "rationale-aa11#0/../../etc/passwd",
    );
    expect(anchor.filename).toMatch(/^[a-zA-Z0-9._-]+\.jsonld$/);
    expect(anchor.filename).not.toContain("/");
    expect(anchor.filename).not.toContain("#");
  });
});
