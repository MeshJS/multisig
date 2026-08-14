import { describe, expect, it } from "@jest/globals";
import {
  pubKeyAddress,
  resolveNativeScriptHash,
  resolvePaymentKeyHash,
  resolveStakeKeyHash,
  serializeAddressObj,
  serializeNativeScript,
  serializeRewardAddress,
  type NativeScript,
} from "@meshsdk/core";

import {
  buildImportFromRegistration,
  buildSlotAddresses,
  collectNativeScriptSigHashes,
  deriveStakeCredentialFromKeys,
  keyHashesToBaseAddress,
  keyHashToEnterpriseAddress,
  matchAddressesToSigSlots,
  providerScriptJsonToNativeScript,
  recoverRoleKeySets,
  restoreStakeKeysFromAddresses,
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

describe("keyHashesToBaseAddress", () => {
  it("produces a base address that round-trips both key hashes", () => {
    const address = keyHashesToBaseAddress(hashA, mockKeyHashes.stake1, 0);
    expect(address.startsWith("addr_test1")).toBe(true);
    expect(resolvePaymentKeyHash(address)).toBe(hashA);
    expect(resolveStakeKeyHash(address)).toBe(mockKeyHashes.stake1);
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
    // (Stake set is unrecoverable here — types is [0] — so no base
    // addresses are constructed.)
    expect(input.signersAddresses).toContain(userAddress);
    expect(input.signersAddresses).toContain(
      keyHashToEnterpriseAddress(hashB, 0),
    );
    for (const addr of input.signersAddresses) {
      expect([hashA, hashB]).toContain(resolvePaymentKeyHash(addr));
    }
    expect(input.signersDescriptions.sort()).toEqual(["Alice", "Bob"]);
  });

  it("recovers per-signer stake and dRep keys from the participants map", () => {
    const stakeA = mockKeyHashes.stake1;
    const stakeB = mockKeyHashes.stake2;
    const realStakeCredential = deriveStakeCredentialFromKeys({
      stakeKeys: [stakeA, stakeB],
      numRequiredSigners: 2,
      scriptType: "atLeast",
      networkId: 0,
    })!;
    const expected = serializeExpected(realStakeCredential);
    const result = buildImportFromRegistration({
      registration: {
        tx_hash: "a".repeat(64),
        json_metadata: {
          types: [0, 2, 3],
          name: "Full wallet",
          participants: {
            [hashA]: { name: "Alice" },
            [hashB]: { name: "Bob" },
            [stakeA]: { name: "Alice" },
            [stakeB]: { name: "Bob" },
            [mockKeyHashes.drep1]: { name: "Alice" },
          },
        },
      },
      candidate: {
        address: expected.address,
        scriptHash: "0".repeat(56),
        stakeCredentialHash: realStakeCredential,
        scriptJson,
      },
      networkId: 0,
      userAddress,
      userPaymentKeyHash: hashA,
    });

    expect(result.error).toBeUndefined();
    const input = result.input!;
    const slotOfA = result.sigHashes!.indexOf(hashA);
    const slotOfB = result.sigHashes!.indexOf(hashB);
    expect(input.recovery?.stakeRestored).toBe(true);
    expect(input.recovery?.drepRestored).toBe(true);
    expect(input.recovery?.pairedByName).toBe(true);
    // The user's own slot keeps their wallet-reported address; the
    // co-signer's slot gets their CONSTRUCTED base address (payment +
    // name-paired stake hash) — the string their wallet reports, so the
    // wallet is visible to them without paste or invite.
    expect(input.signersAddresses[slotOfA]).toBe(userAddress);
    expect(input.signersAddresses[slotOfB]).toBe(
      keyHashesToBaseAddress(hashB, stakeB, 0),
    );
    expect(resolvePaymentKeyHash(input.signersAddresses[slotOfB]!)).toBe(hashB);
    expect(resolveStakeKeyHash(input.signersAddresses[slotOfB]!)).toBe(stakeB);
    expect(input.signersStakeKeys[slotOfA]).toBe(
      serializeRewardAddress(stakeA, false, 0),
    );
    expect(input.signersStakeKeys[slotOfB]).toBe(
      serializeRewardAddress(stakeB, false, 0),
    );
    expect(input.signersDRepKeys[slotOfA]).toBe(mockKeyHashes.drep1);
    expect(input.signersDRepKeys[slotOfB]).toBe("");
    // The recovered stake keys reproduce the on-chain credential exactly.
    expect(
      deriveStakeCredentialFromKeys({
        stakeKeys: input.signersStakeKeys,
        numRequiredSigners: input.numRequiredSigners,
        scriptType: input.scriptType,
        networkId: 0,
      }),
    ).toBe(realStakeCredential);
    // External credential is still carried for draft-address assertions.
    expect(input.stakeCredentialHash).toBe(realStakeCredential);
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

  it("slots recovered addresses between assignments and the fallback", () => {
    const result = buildSlotAddresses({
      sigHashes: [hashA, hashB, mockKeyHashes.drep1],
      lockedSlots: { 0: "addr_test1locked" },
      assignments: { 1: "addr_test1pasted" },
      recovered: {
        0: "addr_test1recovered0", // loses to locked
        1: "addr_test1recovered1", // loses to pasted assignment
        2: "addr_test1recovered2", // wins over the fallback
      },
      networkId: 0,
      fallback: "enterprise",
    });
    expect(result).toEqual([
      "addr_test1locked",
      "addr_test1pasted",
      "addr_test1recovered2",
    ]);
  });

  it("lets empty recovered entries fall through to the fallback", () => {
    const result = buildSlotAddresses({
      sigHashes,
      lockedSlots: {},
      assignments: {},
      recovered: { 0: "" },
      networkId: 0,
      fallback: "enterprise",
    });
    expect(result).toEqual([
      keyHashToEnterpriseAddress(hashA, 0),
      keyHashToEnterpriseAddress(hashB, 0),
    ]);
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

describe("deriveStakeCredentialFromKeys", () => {
  const stakeHashA = mockKeyHashes.stake1;
  const stakeHashB = mockKeyHashes.stake2;
  const expectedHash = resolveNativeScriptHash({
    type: "atLeast",
    required: 2,
    scripts: [stakeHashA, stakeHashB]
      .sort((a, b) => a.localeCompare(b))
      .map((keyHash) => ({ type: "sig", keyHash })),
  }).toLowerCase();

  it("derives the sorted role-2 script hash from 56-hex inputs", () => {
    expect(
      deriveStakeCredentialFromKeys({
        stakeKeys: [stakeHashA, stakeHashB],
        numRequiredSigners: 2,
        scriptType: "atLeast",
        networkId: 0,
      }),
    ).toBe(expectedHash);
  });

  it("is order-independent and case-insensitive", () => {
    expect(
      deriveStakeCredentialFromKeys({
        stakeKeys: [stakeHashB.toUpperCase(), stakeHashA],
        numRequiredSigners: 2,
        scriptType: "atLeast",
        networkId: 0,
      }),
    ).toBe(expectedHash);
  });

  it("accepts bech32 reward addresses", () => {
    expect(
      deriveStakeCredentialFromKeys({
        stakeKeys: [
          serializeRewardAddress(stakeHashA, false, 0),
          serializeRewardAddress(stakeHashB, false, 0),
        ],
        numRequiredSigners: 2,
        scriptType: "atLeast",
        networkId: 0,
      }),
    ).toBe(expectedHash);
  });

  it("returns undefined for empty, blank or invalid entries", () => {
    expect(
      deriveStakeCredentialFromKeys({
        stakeKeys: [],
        numRequiredSigners: 1,
        scriptType: "atLeast",
        networkId: 0,
      }),
    ).toBeUndefined();
    expect(
      deriveStakeCredentialFromKeys({
        stakeKeys: [stakeHashA, ""],
        numRequiredSigners: 2,
        scriptType: "atLeast",
        networkId: 0,
      }),
    ).toBeUndefined();
    expect(
      deriveStakeCredentialFromKeys({
        stakeKeys: [stakeHashA, "not-a-stake-key"],
        numRequiredSigners: 2,
        scriptType: "atLeast",
        networkId: 0,
      }),
    ).toBeUndefined();
  });
});

describe("recoverRoleKeySets", () => {
  // Deterministic distinct 56-hex key hashes.
  const kh = (n: number) => n.toString(16).padStart(2, "0").repeat(28);
  const p = [kh(0x10), kh(0x11), kh(0x12)]; // payment
  const s = [kh(0x20), kh(0x21), kh(0x22)]; // stake
  const d = [kh(0x30), kh(0x31), kh(0x32)]; // dRep

  const credentialOf = (stakeHashes: string[]) =>
    deriveStakeCredentialFromKeys({
      stakeKeys: stakeHashes,
      numRequiredSigners: 2,
      scriptType: "atLeast",
      networkId: 0,
    })!;

  const baseArgs = {
    sigHashes: p,
    numRequiredSigners: 2,
    scriptType: "atLeast" as const,
    networkId: 0,
  };

  const named = (entries: Array<[string, string]>) =>
    Object.fromEntries(entries.map(([hash, name]) => [hash, { name }]));

  it("recovers full 3x3 role sets paired by participant name", () => {
    const result = recoverRoleKeySets({
      ...baseArgs,
      participants: named([
        [p[0]!, "Signer 1"],
        [p[1]!, "Signer 2"],
        [p[2]!, "Signer 3"],
        [s[0]!, "Signer 1"],
        [s[1]!, "Signer 2"],
        [s[2]!, "Signer 3"],
        [d[0]!, "Signer 1"],
        [d[1]!, "Signer 2"],
        [d[2]!, "Signer 3"],
      ]),
      stakeCredentialHash: credentialOf(s),
      registrationTypes: [0, 2, 3],
    });

    expect(result.stakeRestored).toBe(true);
    expect(result.drepRestored).toBe(true);
    expect(result.pairedByName).toBe(true);
    expect(result.signersStakeKeys).toEqual(
      s.map((hash) => serializeRewardAddress(hash, false, 0)),
    );
    expect(result.signersDRepKeys).toEqual(d);
    // Name-paired recovery also reconstructs each signer's real base
    // address (payment hash + their own stake hash).
    expect(result.signersBaseAddresses).toEqual(
      p.map((hash, i) => keyHashesToBaseAddress(hash, s[i]!, 0)),
    );
    for (const [i, address] of result.signersBaseAddresses.entries()) {
      expect(resolvePaymentKeyHash(address)).toBe(p[i]);
      expect(resolveStakeKeyHash(address)).toBe(s[i]);
    }
  });

  it("recovers the real preprod shape: some signers have no dRep key", () => {
    // 3 signers, 7 hashes: signer 1 registered payment+stake+dRep, the
    // others payment+stake only (types still [0,3,2]).
    const result = recoverRoleKeySets({
      ...baseArgs,
      participants: named([
        [p[0]!, "Preprod 1"],
        [p[1]!, "Preprod 2"],
        [p[2]!, "Preprod 3"],
        [s[0]!, "Preprod 1"],
        [s[1]!, "Preprod 2"],
        [s[2]!, "Preprod 3"],
        [d[0]!, "Preprod 1"],
      ]),
      stakeCredentialHash: credentialOf(s),
      registrationTypes: [0, 3, 2],
    });

    expect(result.stakeRestored).toBe(true);
    expect(result.drepRestored).toBe(true);
    expect(result.pairedByName).toBe(true);
    expect(result.signersStakeKeys).toEqual(
      s.map((hash) => serializeRewardAddress(hash, false, 0)),
    );
    expect(result.signersDRepKeys).toEqual([d[0], "", ""]);
  });

  it("recovers exact SETS via combinatorial fallback when names are unusable", () => {
    const participants = named([
      // duplicate names -> name groups cannot identify signers
      ...p.map((h) => [h, "same"] as [string, string]),
      ...s.map((h) => [h, "same"] as [string, string]),
      ...d.map((h) => [h, ""] as [string, string]),
    ]);
    const result = recoverRoleKeySets({
      ...baseArgs,
      participants,
      stakeCredentialHash: credentialOf(s),
      registrationTypes: [0, 2, 3],
    });

    expect(result.stakeRestored).toBe(true);
    expect(result.pairedByName).toBe(false);
    // Arbitrary pairing must never mint a base address.
    expect(result.signersBaseAddresses).toEqual(["", "", ""]);
    // Slot pairing is arbitrary but the sets are exact.
    const recoveredStakeSet = result.signersStakeKeys.map((addr) =>
      deriveStakeCredentialFromKeys({
        stakeKeys: [addr],
        numRequiredSigners: 1,
        scriptType: "all",
        networkId: 0,
      }),
    );
    expect(credentialOf(result.signersStakeKeys)).toBe(credentialOf(s));
    expect(recoveredStakeSet).toHaveLength(3);
    expect(result.drepRestored).toBe(true);
    expect([...result.signersDRepKeys].sort()).toEqual([...d].sort());
  });

  it("does not restore anything when the stake credential matches no subset", () => {
    const result = recoverRoleKeySets({
      ...baseArgs,
      participants: named([
        ...p.map((h, i) => [h, `Signer ${i}`] as [string, string]),
        ...s.map((h, i) => [h, `Signer ${i}`] as [string, string]),
        ...d.map((h, i) => [h, `Signer ${i}`] as [string, string]),
      ]),
      stakeCredentialHash: "0".repeat(56), // foreign credential
      registrationTypes: [0, 2, 3],
    });
    expect(result.stakeRestored).toBe(false);
    expect(result.drepRestored).toBe(false);
    expect(result.signersStakeKeys).toEqual(["", "", ""]);
    expect(result.signersDRepKeys).toEqual(["", "", ""]);
    expect(result.signersBaseAddresses).toEqual(["", "", ""]);
  });

  it("recovers dRep keys without staking when the registration has no role 2", () => {
    const result = recoverRoleKeySets({
      ...baseArgs,
      participants: named([
        ...p.map((h, i) => [h, `Signer ${i + 1}`] as [string, string]),
        ...d.map((h, i) => [h, `Signer ${i + 1}`] as [string, string]),
      ]),
      stakeCredentialHash: null,
      registrationTypes: [0, 3],
    });
    expect(result.stakeRestored).toBe(false);
    expect(result.signersStakeKeys).toEqual(["", "", ""]);
    expect(result.drepRestored).toBe(true);
    expect(result.signersDRepKeys).toEqual(d);
    expect(result.signersBaseAddresses).toEqual(["", "", ""]);
  });

  it("refuses to guess dRep keys when every hash is reused (no leftovers)", () => {
    // types include 3 but participants hold only payment+stake hashes:
    // the dRep keys must reuse other roles' hashes — ambiguous.
    const result = recoverRoleKeySets({
      ...baseArgs,
      participants: named([
        ...p.map((h, i) => [h, `Signer ${i + 1}`] as [string, string]),
        ...s.map((h, i) => [h, `Signer ${i + 1}`] as [string, string]),
      ]),
      stakeCredentialHash: credentialOf(s),
      registrationTypes: [0, 2, 3],
    });
    expect(result.stakeRestored).toBe(true);
    expect(result.drepRestored).toBe(false);
    expect(result.signersDRepKeys).toEqual(["", "", ""]);
  });

  it("ignores dRep leftovers when the registration types exclude role 3", () => {
    const result = recoverRoleKeySets({
      ...baseArgs,
      participants: named([
        ...p.map((h, i) => [h, `Signer ${i + 1}`] as [string, string]),
        ...s.map((h, i) => [h, `Signer ${i + 1}`] as [string, string]),
      ]),
      stakeCredentialHash: credentialOf(s),
      registrationTypes: [0, 2],
    });
    expect(result.stakeRestored).toBe(true);
    expect(result.drepRestored).toBe(false);
    expect(result.signersDRepKeys).toEqual(["", "", ""]);
  });

  it("bails gracefully on pathological participant counts", () => {
    const participants = named(
      Array.from({ length: 41 }, (_, i) => [kh(i + 1), `P${i}`]),
    );
    const result = recoverRoleKeySets({
      ...baseArgs,
      participants,
      stakeCredentialHash: credentialOf(s),
      registrationTypes: [0, 2, 3],
    });
    expect(result.stakeRestored).toBe(false);
    expect(result.drepRestored).toBe(false);
  });
});

describe("restoreStakeKeysFromAddresses", () => {
  const stakeHashA = mockKeyHashes.stake1;
  const stakeHashB = mockKeyHashes.stake2;
  const baseA = serializeAddressObj(pubKeyAddress(hashA, stakeHashA), 0);
  const baseB = serializeAddressObj(pubKeyAddress(hashB, stakeHashB), 0);
  const expected = deriveStakeCredentialFromKeys({
    stakeKeys: [stakeHashA, stakeHashB],
    numRequiredSigners: 2,
    scriptType: "atLeast",
    networkId: 0,
  })!;

  const argsBase = {
    numRequiredSigners: 2,
    scriptType: "atLeast" as const,
    networkId: 0,
  };

  it("restores stake keys when every base address matches the on-chain credential", () => {
    const result = restoreStakeKeysFromAddresses({
      ...argsBase,
      signersAddresses: [baseA, baseB],
      expectedStakeCredentialHash: expected.toUpperCase(),
    });
    expect(result.restored).toBe(true);
    expect(result.stakeCredentialHash).toBeNull();
    expect(result.signersStakeKeys).toEqual([
      serializeRewardAddress(stakeHashA, false, 0),
      serializeRewardAddress(stakeHashB, false, 0),
    ]);
  });

  it("falls back when a slot has an enterprise (stake-less) address", () => {
    const result = restoreStakeKeysFromAddresses({
      ...argsBase,
      signersAddresses: [baseA, keyHashToEnterpriseAddress(hashB, 0)],
      expectedStakeCredentialHash: expected,
    });
    expect(result.restored).toBe(false);
    expect(result.signersStakeKeys).toEqual(["", ""]);
    expect(result.stakeCredentialHash).toBe(expected);
  });

  it("falls back when the derived hash does not match", () => {
    const result = restoreStakeKeysFromAddresses({
      ...argsBase,
      signersAddresses: [baseA, baseB],
      expectedStakeCredentialHash: "0".repeat(56),
    });
    expect(result.restored).toBe(false);
    expect(result.stakeCredentialHash).toBe("0".repeat(56));
  });

  it("falls back for script-stake base addresses and missing expectations", () => {
    const scriptStakeBase = serializeAddressObj(
      pubKeyAddress(hashA, stakeHashA, true),
      0,
    );
    const withScriptStake = restoreStakeKeysFromAddresses({
      ...argsBase,
      signersAddresses: [scriptStakeBase, baseB],
      expectedStakeCredentialHash: expected,
    });
    expect(withScriptStake.restored).toBe(false);

    const noExpectation = restoreStakeKeysFromAddresses({
      ...argsBase,
      signersAddresses: [baseA, baseB],
      expectedStakeCredentialHash: null,
    });
    expect(noExpectation.restored).toBe(false);
    expect(noExpectation.stakeCredentialHash).toBeNull();
  });
});
