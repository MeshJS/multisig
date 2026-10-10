import { describe, expect, it } from "@jest/globals";
import {
  deserializeAddress,
  pubKeyAddress,
  resolvePaymentKeyHash,
  resolveStakeKeyHash,
  serializeAddressObj,
  serializeNativeScript,
  type NativeScript,
} from "@meshsdk/core";

import {
  classifyDiscoverInput,
  describeDiscoverQuery,
} from "../utils/discoverQuery";
import { participantsInclude } from "../utils/cip146Registration";
import {
  externalStakeCredential,
  mockAddresses,
  mockKeyHashes,
  realTestAddresses,
} from "./testUtils";

const hashA = mockKeyHashes.payment1;
const hashB = mockKeyHashes.payment2;

const script: NativeScript = {
  type: "atLeast",
  required: 2,
  scripts: [
    { type: "sig", keyHash: hashA },
    { type: "sig", keyHash: hashB },
  ],
};

describe("classifyDiscoverInput", () => {
  it("treats blank input as the default (own keys) query", () => {
    expect(classifyDiscoverInput("", 0)).toEqual({ kind: "empty" });
    expect(classifyDiscoverInput("   \n", 0)).toEqual({ kind: "empty" });
  });

  it("classifies a bare 56-hex hash as ambiguous and lowercases it", () => {
    expect(classifyDiscoverInput(` ${hashA.toUpperCase()} `, 0)).toEqual({
      kind: "hash",
      hash: hashA,
    });
  });

  it("classifies a base address as a signer query with payment + stake hashes", () => {
    const address = realTestAddresses.address1;
    const result = classifyDiscoverInput(address, 0);
    expect(result).toEqual({
      kind: "signer",
      keyHashes: [
        resolvePaymentKeyHash(address).toLowerCase(),
        deserializeAddress(address).stakeCredentialHash.toLowerCase(),
      ],
    });
  });

  it("classifies an enterprise address as a payment-hash-only signer query", () => {
    const enterprise = serializeAddressObj(pubKeyAddress(hashA), 0);
    expect(classifyDiscoverInput(enterprise, 0)).toEqual({
      kind: "signer",
      keyHashes: [hashA],
    });
  });

  it("classifies a stake address as a signer query by stake hash", () => {
    expect(classifyDiscoverInput(externalStakeCredential, 0)).toEqual({
      kind: "signer",
      keyHashes: [resolveStakeKeyHash(externalStakeCredential).toLowerCase()],
    });
  });

  it("classifies a multisig (script) address as a policy query", () => {
    const { address, scriptCbor } = serializeNativeScript(
      script,
      undefined,
      0,
      true,
    );
    expect(scriptCbor).toBeTruthy();
    const scriptHash = deserializeAddress(address).scriptHash.toLowerCase();
    expect(scriptHash).toMatch(/^[0-9a-f]{56}$/);
    expect(classifyDiscoverInput(address, 0)).toEqual({
      kind: "policy",
      scriptHash,
      address,
    });
  });

  it("rejects addresses from the other network", () => {
    expect(classifyDiscoverInput(mockAddresses.mainnet, 0)).toEqual({
      kind: "invalid",
      reason: "wrong-network",
    });
    expect(classifyDiscoverInput(realTestAddresses.address1, 1)).toEqual({
      kind: "invalid",
      reason: "wrong-network",
    });
    expect(classifyDiscoverInput(externalStakeCredential, 1)).toEqual({
      kind: "invalid",
      reason: "wrong-network",
    });
  });

  it("rejects malformed input", () => {
    expect(classifyDiscoverInput("hello", 0)).toEqual({
      kind: "invalid",
      reason: "malformed",
    });
    expect(classifyDiscoverInput("addr_test1notreallyanaddress", 0)).toEqual({
      kind: "invalid",
      reason: "malformed",
    });
    expect(classifyDiscoverInput("stake_test1nope", 0)).toEqual({
      kind: "invalid",
      reason: "malformed",
    });
    // 55 hex chars — one short of a hash, not an address either
    expect(classifyDiscoverInput("a".repeat(55), 0)).toEqual({
      kind: "invalid",
      reason: "malformed",
    });
  });
});

describe("describeDiscoverQuery", () => {
  it("labels each query kind for result copy", () => {
    expect(describeDiscoverQuery({ kind: "empty" })).toBe("your keys");
    expect(describeDiscoverQuery({ kind: "signer", keyHashes: [hashA] })).toBe(
      "this signer",
    );
    expect(
      describeDiscoverQuery({ kind: "policy", scriptHash: hashA }),
    ).toBe("this wallet");
    expect(describeDiscoverQuery({ kind: "hash", hash: hashA })).toBe(
      "this hash",
    );
  });
});

describe("participantsInclude", () => {
  const item = {
    tx_hash: "1".repeat(64),
    json_metadata: {
      types: [0, 2],
      participants: {
        [hashA.toUpperCase()]: { name: "Alice" },
        [hashB]: { name: "Bob" },
        [mockKeyHashes.stake1]: { name: "Alice stake" },
      },
    },
  };

  it("accepts a script whose signers are all participants (subset)", () => {
    expect(participantsInclude(item, [hashA, hashB])).toBe(true);
    expect(participantsInclude(item, [hashA.toUpperCase()])).toBe(true);
  });

  it("rejects a script with a signer the registration does not list", () => {
    expect(participantsInclude(item, [hashA, mockKeyHashes.drep1])).toBe(false);
  });

  it("rejects empty queries and items without participants", () => {
    expect(participantsInclude(item, [])).toBe(false);
    expect(participantsInclude({ tx_hash: "2".repeat(64) }, [hashA])).toBe(
      false,
    );
  });
});
