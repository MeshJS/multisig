import { generateKeyPairSync } from "crypto";
import { describe, expect, it } from "@jest/globals";

import {
  ATTESTATION_DOMAIN,
  ATTESTATION_STATEMENT,
  GENESIS_PREV,
  attestationHash,
  attestationKeyId,
  buildAttestationPayload,
  signAttestation,
  verifyAttestation,
  verifyAttestationChain,
  type AttestationRecord,
} from "@/lib/documents/attestation";

/**
 * The platform attestation is a timestamp and ordering record, so the only
 * properties worth testing are the ones an auditor would otherwise have to
 * trust the database for: that a chain verifies when it is honest, and that
 * every way of altering history is detected.
 */

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spkiHex = publicKey
    .export({ type: "spki", format: "der" })
    .toString("hex");
  return { privateKey, spkiHex, keyId: attestationKeyId(spkiHex) };
}

const KEY = keypair();
const KEYS = { [KEY.keyId]: KEY.spkiHex };

const DOC = "doc_abc";
const WALLET = "wallet_1";

/** A chain of `n` versions, honestly signed and correctly linked. */
function chain(n: number, key = KEY): AttestationRecord[] {
  const out: AttestationRecord[] = [];
  let prev = GENESIS_PREV;
  for (let i = 1; i <= n; i++) {
    const payload = buildAttestationPayload({
      attestedAt: new Date(Date.UTC(2026, 0, i, 12)),
      contentHash: String(i).repeat(64).slice(0, 64),
      documentId: DOC,
      prevAttestationHash: prev,
      sequence: i,
      versionId: `ver_${i}`,
      versionNumber: i,
      walletId: WALLET,
    });
    out.push({
      payload,
      signature: signAttestation(payload, key.privateKey),
      publicKeyId: key.keyId,
    });
    prev = attestationHash(payload);
  }
  return out;
}

describe("a single attestation", () => {
  it("verifies under the key that signed it", () => {
    const [record] = chain(1);
    expect(
      verifyAttestation(record!.payload, record!.signature, KEY.spkiHex),
    ).toBe(true);
  });

  it("says in its own bytes that it is not an approval", () => {
    const [record] = chain(1);
    expect(record!.payload.statement).toBe(ATTESTATION_STATEMENT);
    expect(record!.payload.statement).toMatch(/not an approval/i);
    expect(record!.payload.statement).toMatch(/grants no authority/i);
    expect(record!.payload.domain).toBe(ATTESTATION_DOMAIN);
  });

  it("does not verify under a different key", () => {
    const other = keypair();
    const [record] = chain(1);
    expect(
      verifyAttestation(record!.payload, record!.signature, other.spkiHex),
    ).toBe(false);
  });

  it("does not verify once any signed field is changed", () => {
    const [record] = chain(1);
    for (const mutate of [
      { contentHash: "b".repeat(64) },
      { versionNumber: 99 },
      { attestedAt: "2020-01-01T00:00:00.000Z" },
      { walletId: "wallet_2" },
      { statement: "I approve this document." },
    ]) {
      expect(
        verifyAttestation(
          { ...record!.payload, ...mutate },
          record!.signature,
          KEY.spkiHex,
        ),
      ).toBe(false);
    }
  });

  it("rejects a malformed signature rather than throwing", () => {
    const [record] = chain(1);
    for (const bad of ["", "zz", "ff", "f".repeat(127), "g".repeat(128)]) {
      expect(verifyAttestation(record!.payload, bad, KEY.spkiHex)).toBe(false);
    }
  });

  it("rejects a malformed public key rather than throwing", () => {
    const [record] = chain(1);
    expect(
      verifyAttestation(record!.payload, record!.signature, "not-a-key"),
    ).toBe(false);
  });
});

describe("the chain", () => {
  it("verifies an honest history and reports its head", () => {
    const records = chain(3);
    const result = verifyAttestationChain(records, KEYS);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.head).toBe(attestationHash(records[2]!.payload));
  });

  it("starts from genesis", () => {
    expect(chain(1)[0]!.payload.prevAttestationHash).toBe(GENESIS_PREV);
  });

  it("refuses an empty chain", () => {
    expect(verifyAttestationChain([], KEYS).ok).toBe(false);
  });

  it("detects a reordered history", () => {
    const [a, b, c] = chain(3);
    const swapped = [a!, c!, b!];
    const result = verifyAttestationChain(swapped, KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/does not link|expected sequence/);
  });

  it("detects a removed version", () => {
    const [a, , c] = chain(3);
    const result = verifyAttestationChain([a!, c!], KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/does not link|expected sequence/);
  });

  it("detects an altered version, even re-signed by the real key", () => {
    // The strongest case: an attacker who HAS the key rewrites history in
    // place. The link from the next attestation still commits to the original,
    // so the tampering surfaces anyway.
    const records = chain(3);
    const rewritten = {
      ...records[1]!.payload,
      contentHash: "e".repeat(64),
    };
    records[1] = {
      payload: rewritten,
      signature: signAttestation(rewritten, KEY.privateKey),
      publicKeyId: KEY.keyId,
    };
    const result = verifyAttestationChain(records, KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/does not link/);
  });

  it("detects a back-dated attestation", () => {
    const records = chain(3);
    const backdated = {
      ...records[2]!.payload,
      attestedAt: "2000-01-01T00:00:00.000Z",
    };
    records[2] = {
      payload: backdated,
      signature: signAttestation(backdated, KEY.privateKey),
      publicKeyId: KEY.keyId,
    };
    const result = verifyAttestationChain(records, KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/attested before/);
  });

  it("refuses an attestation signed by a key it does not know", () => {
    const rogue = keypair();
    const records = chain(2, rogue);
    const result = verifyAttestationChain(records, KEYS);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/unknown key/);
  });

  it("refuses a forged attestation appended without the key", () => {
    const records = chain(2);
    const forgedPayload = buildAttestationPayload({
      attestedAt: new Date(Date.UTC(2026, 0, 3, 12)),
      contentHash: "c".repeat(64),
      documentId: DOC,
      prevAttestationHash: attestationHash(records[1]!.payload),
      sequence: 3,
      versionId: "ver_3",
      versionNumber: 3,
      walletId: WALLET,
    });
    // Correctly linked, correctly sequenced — and unsigned by anyone who could.
    const result = verifyAttestationChain(
      [
        ...records,
        {
          payload: forgedPayload,
          signature: "0".repeat(128),
          publicKeyId: KEY.keyId,
        },
      ],
      KEYS,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/signature does not verify/);
  });

  it("refuses a chain that splices in another document's attestation", () => {
    const mine = chain(1);
    const theirs = chain(1);
    const spliced = [
      mine[0]!,
      {
        ...theirs[0]!,
        payload: { ...theirs[0]!.payload, documentId: "doc_other" },
      },
    ];
    expect(verifyAttestationChain(spliced, KEYS).ok).toBe(false);
  });

  it("accepts a rotated key when both keys are known", () => {
    const older = KEY;
    const newer = keypair();

    const first = buildAttestationPayload({
      attestedAt: new Date(Date.UTC(2026, 0, 1, 12)),
      contentHash: "a".repeat(64),
      documentId: DOC,
      prevAttestationHash: GENESIS_PREV,
      sequence: 1,
      versionId: "ver_1",
      versionNumber: 1,
      walletId: WALLET,
    });
    const second = buildAttestationPayload({
      attestedAt: new Date(Date.UTC(2026, 0, 2, 12)),
      contentHash: "b".repeat(64),
      documentId: DOC,
      prevAttestationHash: attestationHash(first),
      sequence: 2,
      versionId: "ver_2",
      versionNumber: 2,
      walletId: WALLET,
    });

    const result = verifyAttestationChain(
      [
        {
          payload: first,
          signature: signAttestation(first, older.privateKey),
          publicKeyId: older.keyId,
        },
        {
          payload: second,
          signature: signAttestation(second, newer.privateKey),
          publicKeyId: newer.keyId,
        },
      ],
      { ...KEYS, [newer.keyId]: newer.spkiHex },
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
