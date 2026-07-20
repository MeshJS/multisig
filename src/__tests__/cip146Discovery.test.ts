import { describe, expect, it } from "@jest/globals";
import {
  resolvePaymentKeyHash,
  serializeNativeScript,
  type NativeScript,
} from "@meshsdk/core";

import {
  buildImportFromRegistration,
  buildSlotAddresses,
  collectNativeScriptSigHashes,
  keyHashToEnterpriseAddress,
  matchAddressesToSigSlots,
  providerScriptJsonToNativeScript,
  verifyScriptCborAddress,
} from "../utils/cip146Discovery";
import {
  externalStakeCredential,
  mockKeyHashes,
  realTestAddresses,
} from "./testUtils";

const hashA = mockKeyHashes.payment1;
const hashB = mockKeyHashes.payment2;
const stakeCredentialHash = mockKeyHashes.stake1;

const scriptJson = {
  type: "atLeast",
  required: 2,
  scripts: [
    { type: "sig", keyHash: hashA },
    { type: "sig", keyHash: hashB },
  ],
};

function serializeExpected(stakeHash?: string) {
  return serializeNativeScript(
    providerScriptJsonToNativeScript(scriptJson),
    stakeHash,
    0,
    true,
  );
}

describe("providerScriptJsonToNativeScript", () => {
  it("maps sig/all/any/atLeast/after nodes", () => {
    const converted = providerScriptJsonToNativeScript({
      type: "all",
      scripts: [
        { type: "sig", keyHash: hashA },
        { type: "any", scripts: [{ type: "sig", keyHash: hashB }] },
        { type: "after", slot: 1234 },
      ],
    });
    expect(converted).toEqual({
      type: "all",
      scripts: [
        { type: "sig", keyHash: hashA },
        { type: "any", scripts: [{ type: "sig", keyHash: hashB }] },
        { type: "after", slot: "1234" },
      ],
    });
  });

  it("throws on unsupported input", () => {
    expect(() => providerScriptJsonToNativeScript(null)).toThrow();
    expect(() =>
      providerScriptJsonToNativeScript({ type: "plutus" }),
    ).toThrow();
    expect(() => providerScriptJsonToNativeScript({ type: "sig" })).toThrow();
  });
});

describe("collectNativeScriptSigHashes", () => {
  it("collects hashes in script order, deduplicated and lowercased", () => {
    const script: NativeScript = {
      type: "atLeast",
      required: 1,
      scripts: [
        { type: "sig", keyHash: hashB.toUpperCase() },
        { type: "sig", keyHash: hashA },
        { type: "sig", keyHash: hashB },
      ],
    };
    expect(collectNativeScriptSigHashes(script)).toEqual([hashB, hashA]);
  });
});

describe("keyHashToEnterpriseAddress", () => {
  it("produces an address that round-trips to the same payment key hash", () => {
    const address = keyHashToEnterpriseAddress(hashA, 0);
    expect(address.startsWith("addr_test1")).toBe(true);
    expect(resolvePaymentKeyHash(address)).toBe(hashA);
  });
});

describe("buildImportFromRegistration", () => {
  const userAddress = keyHashToEnterpriseAddress(hashA, 0);
  const registration = {
    tx_hash: "a".repeat(64),
    json_metadata: {
      types: [0],
      name: ["My Long Wallet ", "Name"],
      description: "Team funds",
      participants: {
        [hashA]: { name: "Alice" },
        [hashB]: { name: "Bob" },
      },
    },
  };

  it("reconstructs an importable wallet verified against the on-chain address", () => {
    const expected = serializeExpected(stakeCredentialHash);
    const result = buildImportFromRegistration({
      registration,
      candidate: {
        address: expected.address,
        scriptHash: "0".repeat(56),
        stakeCredentialHash,
        scriptJson,
      },
      networkId: 0,
      userAddress,
      userPaymentKeyHash: hashA,
    });

    expect(result.error).toBeUndefined();
    const input = result.input!;
    expect(input.name).toBe("My Long Wallet Name");
    expect(input.description).toBe("Team funds");
    expect(input.scriptType).toBe("atLeast");
    expect(input.numRequiredSigners).toBe(2);
    expect(input.scriptCbor).toBe(expected.scriptCbor);
    expect(input.stakeCredentialHash).toBe(stakeCredentialHash);
    // User's own slot carries their real address; others get derived
    // enterprise addresses that round-trip to the script's key hashes.
    expect(input.signersAddresses).toContain(userAddress);
    for (const addr of input.signersAddresses) {
      expect([hashA, hashB]).toContain(resolvePaymentKeyHash(addr));
    }
    expect(input.signersDescriptions.sort()).toEqual(["Alice", "Bob"]);
  });

  it("refuses to import when the reconstructed address differs", () => {
    const result = buildImportFromRegistration({
      registration,
      candidate: {
        address: keyHashToEnterpriseAddress(hashB, 0), // wrong address
        scriptHash: "0".repeat(56),
        stakeCredentialHash,
        scriptJson,
      },
      networkId: 0,
      userAddress,
      userPaymentKeyHash: hashA,
    });
    expect(result.input).toBeUndefined();
    expect(result.error).toMatch(/does not match/);
  });

  it("rejects candidates whose signers are not registration participants", () => {
    const foreignScriptJson = {
      type: "all",
      scripts: [{ type: "sig", keyHash: mockKeyHashes.stake2 }],
    };
    const expected = serializeNativeScript(
      providerScriptJsonToNativeScript(foreignScriptJson),
      undefined,
      0,
      true,
    );
    const result = buildImportFromRegistration({
      registration,
      candidate: {
        address: expected.address,
        scriptHash: "0".repeat(56),
        stakeCredentialHash: null,
        scriptJson: foreignScriptJson,
      },
      networkId: 0,
      userAddress,
      userPaymentKeyHash: hashA,
    });
    expect(result.error).toMatch(/don't match the registration's participants/);
  });

  it("rejects users who are not payment signers", () => {
    const expected = serializeExpected(stakeCredentialHash);
    const result = buildImportFromRegistration({
      registration,
      candidate: {
        address: expected.address,
        scriptHash: "0".repeat(56),
        stakeCredentialHash,
        scriptJson,
      },
      networkId: 0,
      userAddress: keyHashToEnterpriseAddress(mockKeyHashes.drep1, 0),
      userPaymentKeyHash: mockKeyHashes.drep1,
    });
    expect(result.error).toMatch(/not a payment signer/);
  });
});

describe("matchAddressesToSigSlots", () => {
  const realHash = resolvePaymentKeyHash(realTestAddresses.address1);
  const sigHashes = [realHash, hashA, hashB];
  const enterpriseB = keyHashToEnterpriseAddress(hashB, 0);

  it("assigns pasted addresses to slots by payment key hash, any order", () => {
    const { assignments, errors } = matchAddressesToSigSlots({
      sigHashes,
      pastedLines: [enterpriseB, realTestAddresses.address1],
      networkId: 0,
    });
    expect(errors).toEqual([]);
    expect(assignments).toEqual({
      0: realTestAddresses.address1,
      2: enterpriseB,
    });
  });

  it("rejects stake addresses, invalid lines, unknown signers and wrong network", () => {
    const { assignments, errors } = matchAddressesToSigSlots({
      sigHashes,
      pastedLines: [
        externalStakeCredential,
        "not-an-address",
        keyHashToEnterpriseAddress(mockKeyHashes.drep1, 0),
        keyHashToEnterpriseAddress(hashA, 1), // mainnet address on preprod
      ],
      networkId: 0,
    });
    expect(assignments).toEqual({});
    expect(errors.map((e) => e.reason)).toEqual([
      "stake-address",
      "invalid",
      "not-a-signer",
      "wrong-network",
    ]);
  });

  it("flags two different addresses resolving to the same slot", () => {
    const { assignments, errors } = matchAddressesToSigSlots({
      sigHashes,
      pastedLines: [
        realTestAddresses.address1,
        keyHashToEnterpriseAddress(realHash, 0),
      ],
      networkId: 0,
    });
    expect(assignments).toEqual({ 0: realTestAddresses.address1 });
    expect(errors).toEqual([
      {
        line: keyHashToEnterpriseAddress(realHash, 0),
        reason: "duplicate-slot",
      },
    ]);
  });

  it("silently skips addresses matching a locked slot", () => {
    const { assignments, errors } = matchAddressesToSigSlots({
      sigHashes,
      lockedSlots: { 0: realTestAddresses.address1 },
      pastedLines: [realTestAddresses.address1],
      networkId: 0,
    });
    expect(assignments).toEqual({});
    expect(errors).toEqual([]);
  });
});

describe("buildSlotAddresses", () => {
  const sigHashes = [hashA, hashB];

  it("applies locked > assigned > fallback precedence", () => {
    const result = buildSlotAddresses({
      sigHashes,
      lockedSlots: { 0: "addr_test1locked" },
      assignments: { 0: "addr_test1assigned", 1: "addr_test1other" },
      networkId: 0,
      fallback: "enterprise",
    });
    expect(result).toEqual(["addr_test1locked", "addr_test1other"]);
  });

  it("falls back to enterprise addresses or raw key hashes", () => {
    const enterprise = buildSlotAddresses({
      sigHashes,
      lockedSlots: {},
      assignments: {},
      networkId: 0,
      fallback: "enterprise",
    });
    expect(enterprise).toEqual([
      keyHashToEnterpriseAddress(hashA, 0),
      keyHashToEnterpriseAddress(hashB, 0),
    ]);

    const keyhash = buildSlotAddresses({
      sigHashes,
      lockedSlots: {},
      assignments: {},
      networkId: 0,
      fallback: "keyhash",
    });
    expect(keyhash).toEqual([hashA, hashB]);
  });
});

describe("verifyScriptCborAddress", () => {
  it("confirms a script CBOR that reproduces the expected address", () => {
    const { address, scriptCbor } = serializeExpected(stakeCredentialHash);
    expect(
      verifyScriptCborAddress({
        scriptCbor: scriptCbor!,
        stakeCredentialHash,
        networkId: 0,
        expectedAddress: address,
      }),
    ).toBe(true);
  });

  it("rejects a mismatched address and garbage CBOR", () => {
    const { scriptCbor } = serializeExpected(stakeCredentialHash);
    expect(
      verifyScriptCborAddress({
        scriptCbor: scriptCbor!,
        stakeCredentialHash: null,
        networkId: 0,
        expectedAddress: keyHashToEnterpriseAddress(hashA, 0),
      }),
    ).toBe(false);
    expect(
      verifyScriptCborAddress({
        scriptCbor: "deadbeef",
        stakeCredentialHash,
        networkId: 0,
        expectedAddress: "addr_test1whatever",
      }),
    ).toBe(false);
  });
});
