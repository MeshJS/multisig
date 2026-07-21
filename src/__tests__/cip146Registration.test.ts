import { describe, expect, it } from "@jest/globals";
import { MultisigWallet } from "../utils/multisigSDK";
import {
  buildLabel1854Metadata,
  chunkMetadataString,
  isRegistrationUpToDate,
  joinMetadataString,
  participantsMatchExactly,
  truncateMetadataString,
} from "../utils/cip146Registration";

const hashA = "a".repeat(56);
const hashB = "b".repeat(56);
const hashC = "c".repeat(56);

function makeWallet(name = "Team Wallet", description = "Shared funds") {
  return new MultisigWallet(
    name,
    [
      { keyHash: hashA, role: 0, name: "Alice" },
      { keyHash: hashB, role: 0, name: "Bob" },
    ],
    description,
    2,
    0,
  );
}

describe("chunkMetadataString", () => {
  it("returns the string unchanged when it fits in 64 bytes", () => {
    expect(chunkMetadataString("short name")).toBe("short name");
  });

  it("chunks long strings into <=64-byte pieces that round-trip", () => {
    const long = "x".repeat(200);
    const chunks = chunkMetadataString(long);
    expect(Array.isArray(chunks)).toBe(true);
    for (const chunk of chunks as string[]) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(64);
    }
    expect(joinMetadataString(chunks)).toBe(long);
  });

  it("chunks by byte length without splitting multi-byte characters", () => {
    // Each emoji is 4 UTF-8 bytes; 40 emoji = 160 bytes.
    const emoji = "🚀".repeat(40);
    const chunks = chunkMetadataString(emoji) as string[];
    expect(Array.isArray(chunks)).toBe(true);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(64);
      // No broken surrogate pairs: re-encoding must be lossless.
      expect(joinMetadataString([chunk])).toBe(chunk);
    }
    expect(joinMetadataString(chunks)).toBe(emoji);
  });
});

describe("truncateMetadataString", () => {
  it("truncates to at most 64 bytes on a character boundary", () => {
    const long = "é".repeat(50); // 2 bytes each = 100 bytes
    const truncated = truncateMetadataString(long);
    expect(new TextEncoder().encode(truncated).length).toBeLessThanOrEqual(64);
    expect(truncated).toBe("é".repeat(32));
  });
});

describe("joinMetadataString", () => {
  it("passes strings through and joins arrays", () => {
    expect(joinMetadataString("abc")).toBe("abc");
    expect(joinMetadataString(["ab", "cd"])).toBe("abcd");
    expect(joinMetadataString(undefined)).toBe("");
    expect(joinMetadataString(42)).toBe("");
  });
});

describe("buildLabel1854Metadata", () => {
  it("builds the CIP-0146 payload from the wallet", () => {
    const payload = buildLabel1854Metadata(makeWallet());
    expect(payload.types).toEqual([0]);
    expect(payload.name).toBe("Team Wallet");
    expect(payload.description).toBe("Shared funds");
    expect(payload.participants).toEqual({
      [hashA]: { name: "Alice" },
      [hashB]: { name: "Bob" },
    });
  });

  it("chunks long name/description and truncates participant names", () => {
    const longName = "n".repeat(100);
    const wallet = new MultisigWallet(
      longName,
      [{ keyHash: hashA, role: 0, name: "p".repeat(100) }],
      "d".repeat(150),
      1,
      0,
    );
    const payload = buildLabel1854Metadata(wallet);
    expect(Array.isArray(payload.name)).toBe(true);
    expect(joinMetadataString(payload.name)).toBe(longName);
    expect(Array.isArray(payload.description)).toBe(true);
    expect(payload.participants![hashA]!.name).toBe("p".repeat(64));
  });

  it("omits empty name and description", () => {
    const wallet = new MultisigWallet(
      "",
      [{ keyHash: hashA, role: 0, name: "Alice" }],
      "",
      1,
      0,
    );
    const payload = buildLabel1854Metadata(wallet);
    expect(payload.name).toBeUndefined();
    expect(payload.description).toBeUndefined();
  });
});

describe("participantsMatchExactly", () => {
  const item = {
    tx_hash: "1".repeat(64),
    json_metadata: {
      types: [0],
      participants: {
        [hashA.toUpperCase()]: { name: "Alice" },
        [hashB]: { name: "Bob" },
      },
    },
  };

  it("matches an identical participant set case-insensitively", () => {
    expect(participantsMatchExactly(item, [hashA, hashB])).toBe(true);
  });

  it("rejects subsets and supersets", () => {
    expect(participantsMatchExactly(item, [hashA])).toBe(false);
    expect(participantsMatchExactly(item, [hashA, hashB, hashC])).toBe(false);
  });

  it("rejects items without participants", () => {
    expect(
      participantsMatchExactly({ tx_hash: "2".repeat(64) }, [hashA]),
    ).toBe(false);
  });
});

describe("isRegistrationUpToDate", () => {
  it("recognizes matching on-chain metadata, including chunked strings", () => {
    const wallet = makeWallet("A Very Long Wallet Name", "desc");
    const payload = buildLabel1854Metadata(wallet);
    const item = { tx_hash: "3".repeat(64), json_metadata: payload };
    expect(isRegistrationUpToDate(item, wallet)).toBe(true);
  });

  it("detects a changed name", () => {
    const wallet = makeWallet();
    const payload = buildLabel1854Metadata(wallet);
    const item = {
      tx_hash: "4".repeat(64),
      json_metadata: { ...payload, name: "Old Name" },
    };
    expect(isRegistrationUpToDate(item, wallet)).toBe(false);
  });

  it("detects a changed participant name", () => {
    const wallet = makeWallet();
    const item = {
      tx_hash: "5".repeat(64),
      json_metadata: {
        types: [0],
        name: "Team Wallet",
        description: "Shared funds",
        participants: {
          [hashA]: { name: "Alice" },
          [hashB]: { name: "Robert" },
        },
      },
    };
    expect(isRegistrationUpToDate(item, wallet)).toBe(false);
  });
});
