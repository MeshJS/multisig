import { generateKeyPairSync } from "crypto";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { TRPCError } from "@trpc/server";

import { makeAnonymousCtx } from "./helpers";

/**
 * The public verify endpoints — `verifyProof` and `verifyAttestationChain` —
 * need no account and read no database, so anyone can send them anything. The
 * contract under test: input the verifier cannot read is a 400 that says so,
 * never a TypeError surfacing as a 500, and an honest chain still verifies.
 *
 * No database is touched, so these run with or without DATABASE_URL.
 */

jest.mock("superjson", () => ({
  __esModule: true,
  default: {
    serialize: (value: unknown) => value,
    deserialize: (value: unknown) => value,
  },
}));

jest.mock("@/server/auth", () => ({
  __esModule: true,
  getServerAuthSession: jest.fn(),
}));

let createCaller: typeof import("@/server/api/root").createCaller;
let attestation: typeof import("@/lib/documents/attestation");
let AUDIT_LIMITS: typeof import("@/lib/documents/audit").AUDIT_LIMITS;
let canonicalize: typeof import("@/lib/documents/payload").canonicalize;

beforeAll(async () => {
  ({ createCaller } = await import("@/server/api/root"));
  attestation = await import("@/lib/documents/attestation");
  ({ AUDIT_LIMITS } = await import("@/lib/documents/audit"));
  ({ canonicalize } = await import("@/lib/documents/payload"));
});

// A fresh IP per caller keeps the public rate limiter out of the picture.
const documents = () => createCaller(makeAnonymousCtx() as never).document;

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return "OK";
  } catch (error) {
    return error instanceof TRPCError ? error.code : "THREW";
  }
}

function signedChain(n: number) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spkiHex = publicKey
    .export({ type: "spki", format: "der" })
    .toString("hex");
  const keyId = attestation.attestationKeyId(spkiHex);
  const chain = [];
  let prev = attestation.GENESIS_PREV;
  for (let i = 1; i <= n; i++) {
    const payload = attestation.buildAttestationPayload({
      attestedAt: new Date(Date.UTC(2026, 0, i, 12)),
      contentHash: "a".repeat(64),
      documentId: "doc_1",
      prevAttestationHash: prev,
      sequence: i,
      versionId: `ver_${i}`,
      versionNumber: i,
      walletId: "wallet_1",
    });
    chain.push({
      payload,
      signature: attestation.signAttestation(payload, privateKey),
      publicKeyId: keyId,
    });
    prev = attestation.attestationHash(payload);
  }
  return { chain, publicKeys: { [keyId]: spkiHex } };
}

describe("verifyAttestationChain", () => {
  it("verifies an honest chain", async () => {
    const { chain, publicKeys } = signedChain(2);
    const result = await documents().verifyAttestationChain({
      chain,
      publicKeys,
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("does not trim an extra payload field back into a valid signature", async () => {
    // The payload reaches the verifier exactly as sent: a field the platform
    // never signed must break the signature, not be stripped by validation.
    const { chain, publicKeys } = signedChain(1);
    const padded = [{ ...chain[0]!, payload: { ...chain[0]!.payload, note: "x" } }];
    const result = await documents().verifyAttestationChain({
      chain: padded,
      publicKeys,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("sequence 1: signature does not verify.");
  });

  it.each<[string, unknown]>([
    ["a null payload", null],
    ["a string payload", "payload"],
    ["an array payload", []],
    ["a missing payload", undefined],
  ])("answers %s with BAD_REQUEST", async (_, payload) => {
    const record = { payload, signature: "", publicKeyId: "" };
    expect(
      await codeOf(
        documents().verifyAttestationChain({ chain: [record] } as never),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("refuses a chain longer than an audit package may carry", async () => {
    // Every record costs an Ed25519 verify on a route with no account behind it.
    const { chain } = signedChain(1);
    const long = Array.from({ length: AUDIT_LIMITS.chain + 1 }, () => chain[0]!);
    expect(
      await codeOf(documents().verifyAttestationChain({ chain: long })),
    ).toBe("BAD_REQUEST");
  });
});

describe("verifyProof", () => {
  it.each<[string, unknown]>([
    ["a string version", { version: "v1", policy: "p" }],
    ["null reviews", { version: {}, policy: {}, reviews: null }],
    [
      "a numeric content hash",
      {
        document: { id: "d", walletId: "w" },
        version: { id: "v", versionNumber: 1, contentHash: 5 },
        policy: { requiredSigners: 1, walletPolicyHash: "h", signersAddresses: [] },
        reviews: [],
      },
    ],
  ])("answers %s with BAD_REQUEST", async (_, proof) => {
    expect(await codeOf(documents().verifyProof({ proof }))).toBe(
      "BAD_REQUEST",
    );
  });

  it("answers BAD_REQUEST when the verifier itself throws", async () => {
    // The shape check cannot see inside the signed payload string. A field
    // there that cannot even be printed in an error message makes the
    // verifier throw; that must still come back as a 400.
    const proof = {
      document: { id: "d", walletId: "w" },
      version: { id: "v", versionNumber: 1, contentHash: "a".repeat(64) },
      policy: {
        requiredSigners: 1,
        walletPolicyHash: "h",
        signersAddresses: ["addr_a"],
      },
      reviews: [
        {
          signerAddress: "addr_a",
          action: "approve",
          payload: canonicalize({ documentId: { toString: 1 } }),
          signature: "s",
          signatureKey: "k",
          signedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(await codeOf(documents().verifyProof({ proof }))).toBe(
      "BAD_REQUEST",
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
