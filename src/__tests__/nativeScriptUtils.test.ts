import { describe, it, expect } from "@jest/globals";
import { serializeNativeScript, type NativeScript } from "@meshsdk/core";
import {
  type DecodedNativeScript,
  decodeNativeScriptFromCbor,
  decodedToNativeScript,
  collectSigKeyHashes,
  isHierarchicalScript,
  computeRequiredSigners,
  detectTypeFromSigParents,
  normalizeCborHex,
  countTotalSigs,
  getScriptDepth,
} from "../utils/nativeScriptUtils";

// --- Test fixtures ---

const sigA: DecodedNativeScript = { type: "sig", keyHash: "aaaa" };
const sigB: DecodedNativeScript = { type: "sig", keyHash: "bbbb" };
const sigC: DecodedNativeScript = { type: "sig", keyHash: "cccc" };

const flatAll: DecodedNativeScript = {
  type: "all",
  scripts: [sigA, sigB, sigC],
};

const flatAny: DecodedNativeScript = {
  type: "any",
  scripts: [sigA, sigB],
};

const flatAtLeast: DecodedNativeScript = {
  type: "atLeast",
  required: 2,
  scripts: [sigA, sigB, sigC],
};

// Hierarchical: all(atLeast(2, [sigA, sigB, sigC]))
const hierarchical: DecodedNativeScript = {
  type: "all",
  scripts: [
    {
      type: "atLeast",
      required: 2,
      scripts: [sigA, sigB, sigC],
    },
  ],
};

// Deeply nested: all(any(all(sigA, sigB)))
const deeplyNested: DecodedNativeScript = {
  type: "all",
  scripts: [
    {
      type: "any",
      scripts: [
        {
          type: "all",
          scripts: [sigA, sigB],
        },
      ],
    },
  ],
};

const withTimelock: DecodedNativeScript = {
  type: "all",
  scripts: [
    sigA,
    { type: "timelockStart", slot: "100" },
    { type: "timelockExpiry", slot: "999" },
  ],
};

// --- Tests ---

describe("normalizeCborHex", () => {
  it("should strip 0x prefix", () => {
    expect(normalizeCborHex("0xabcdef")).toBe("abcdef");
  });

  it("should strip 0X prefix (uppercase)", () => {
    expect(normalizeCborHex("0Xabcdef")).toBe("abcdef");
  });

  it("should trim whitespace", () => {
    expect(normalizeCborHex("  abcdef  ")).toBe("abcdef");
  });

  it("should handle empty string", () => {
    expect(normalizeCborHex("")).toBe("");
  });

  it("should pass through valid hex", () => {
    expect(normalizeCborHex("abcdef")).toBe("abcdef");
  });
});

describe("collectSigKeyHashes", () => {
  it("should collect from a single sig", () => {
    expect(collectSigKeyHashes(sigA)).toEqual(["aaaa"]);
  });

  it("should collect from flat all", () => {
    const hashes = collectSigKeyHashes(flatAll);
    expect(hashes).toEqual(["aaaa", "bbbb", "cccc"]);
  });

  it("should collect from hierarchical script", () => {
    const hashes = collectSigKeyHashes(hierarchical);
    expect(hashes).toEqual(["aaaa", "bbbb", "cccc"]);
  });

  it("should collect from deeply nested script", () => {
    const hashes = collectSigKeyHashes(deeplyNested);
    expect(hashes).toEqual(["aaaa", "bbbb"]);
  });

  it("should deduplicate repeated hashes", () => {
    const dup: DecodedNativeScript = {
      type: "all",
      scripts: [sigA, sigA, sigB],
    };
    const hashes = collectSigKeyHashes(dup);
    expect(hashes).toEqual(["aaaa", "bbbb"]);
  });

  it("should return empty for timelock nodes", () => {
    expect(collectSigKeyHashes({ type: "timelockStart", slot: "0" })).toEqual(
      [],
    );
  });

  it("should skip timelocks but collect sigs in mixed scripts", () => {
    const hashes = collectSigKeyHashes(withTimelock);
    expect(hashes).toEqual(["aaaa"]);
  });
});

describe("isHierarchicalScript", () => {
  it("should return false for flat all", () => {
    expect(isHierarchicalScript(flatAll)).toBe(false);
  });

  it("should return false for flat any", () => {
    expect(isHierarchicalScript(flatAny)).toBe(false);
  });

  it("should return false for flat atLeast", () => {
    expect(isHierarchicalScript(flatAtLeast)).toBe(false);
  });

  it("should return true for all(atLeast(...))", () => {
    expect(isHierarchicalScript(hierarchical)).toBe(true);
  });

  it("should return true for deeply nested scripts", () => {
    expect(isHierarchicalScript(deeplyNested)).toBe(true);
  });

  it("should return false for a single sig", () => {
    expect(isHierarchicalScript(sigA)).toBe(false);
  });
});

describe("computeRequiredSigners", () => {
  it("should return 1 for a single sig", () => {
    expect(computeRequiredSigners(sigA)).toBe(1);
  });

  it("should return count of all sigs for 'all'", () => {
    expect(computeRequiredSigners(flatAll)).toBe(3);
  });

  it("should return 1 for 'any' with sigs", () => {
    expect(computeRequiredSigners(flatAny)).toBe(1);
  });

  it("should return required count for flat atLeast", () => {
    expect(computeRequiredSigners(flatAtLeast)).toBe(2);
  });

  it("should handle hierarchical: all(atLeast(2, [sig, sig, sig])) = 2", () => {
    expect(computeRequiredSigners(hierarchical)).toBe(2);
  });

  it("should return 0 for timelockStart", () => {
    expect(computeRequiredSigners({ type: "timelockStart", slot: "0" })).toBe(
      0,
    );
  });

  it("should return 0 for timelockExpiry", () => {
    expect(computeRequiredSigners({ type: "timelockExpiry", slot: "0" })).toBe(
      0,
    );
  });

  it("should handle all with timelocks (only count sigs)", () => {
    // all(sigA, timelockStart, timelockExpiry) -> need sigA = 1
    expect(computeRequiredSigners(withTimelock)).toBe(1);
  });

  it("should return 0 for empty any", () => {
    expect(computeRequiredSigners({ type: "any", scripts: [] })).toBe(0);
  });
});

describe("detectTypeFromSigParents", () => {
  it("should detect 'all' for flat all", () => {
    expect(detectTypeFromSigParents(flatAll)).toBe("all");
  });

  it("should detect 'any' for flat any", () => {
    expect(detectTypeFromSigParents(flatAny)).toBe("any");
  });

  it("should detect 'atLeast' for flat atLeast", () => {
    expect(detectTypeFromSigParents(flatAtLeast)).toBe("atLeast");
  });

  it("should detect 'atLeast' for all(atLeast(...))", () => {
    // sigs' parent is atLeast, so atLeast wins
    expect(detectTypeFromSigParents(hierarchical)).toBe("atLeast");
  });

  it("should detect 'all' for deeply nested all(any(all(sig, sig)))", () => {
    // sigs' parent is 'all' (innermost), but 'any' and 'all' both appear
    // Priority: atLeast > all > any, so 'all' wins
    expect(detectTypeFromSigParents(deeplyNested)).toBe("all");
  });
});

describe("decodedToNativeScript", () => {
  it("should convert sig node", () => {
    expect(decodedToNativeScript(sigA)).toEqual({
      type: "sig",
      keyHash: "aaaa",
    });
  });

  it("should convert flat all", () => {
    const result = decodedToNativeScript(flatAll);
    expect(result).toEqual({
      type: "all",
      scripts: [
        { type: "sig", keyHash: "aaaa" },
        { type: "sig", keyHash: "bbbb" },
        { type: "sig", keyHash: "cccc" },
      ],
    });
  });

  it("should convert flat atLeast with required", () => {
    const result = decodedToNativeScript(flatAtLeast);
    expect(result).toEqual({
      type: "atLeast",
      required: 2,
      scripts: [
        { type: "sig", keyHash: "aaaa" },
        { type: "sig", keyHash: "bbbb" },
        { type: "sig", keyHash: "cccc" },
      ],
    });
  });

  it("should convert hierarchical script recursively", () => {
    const result = decodedToNativeScript(hierarchical);
    expect(result).toEqual({
      type: "all",
      scripts: [
        {
          type: "atLeast",
          required: 2,
          scripts: [
            { type: "sig", keyHash: "aaaa" },
            { type: "sig", keyHash: "bbbb" },
            { type: "sig", keyHash: "cccc" },
          ],
        },
      ],
    });
  });

  it("should convert timelockStart to 'after'", () => {
    const result = decodedToNativeScript({
      type: "timelockStart",
      slot: "12345",
    });
    expect(result).toEqual({ type: "after", slot: "12345" });
  });

  it("should convert timelockExpiry to 'before'", () => {
    const result = decodedToNativeScript({
      type: "timelockExpiry",
      slot: "99999",
    });
    expect(result).toEqual({ type: "before", slot: "99999" });
  });

  it("should handle mixed script with timelocks", () => {
    const result = decodedToNativeScript(withTimelock);
    expect(result).toEqual({
      type: "all",
      scripts: [
        { type: "sig", keyHash: "aaaa" },
        { type: "after", slot: "100" },
        { type: "before", slot: "999" },
      ],
    });
  });
});

describe("decodeNativeScriptFromCbor (integration)", () => {
  it("should decode a serialized hierarchical script", () => {
    const keyHashA = "11".repeat(28);
    const keyHashB = "22".repeat(28);
    const keyHashC = "33".repeat(28);

    const original: NativeScript = {
      type: "all",
      scripts: [
        {
          type: "atLeast",
          required: 2,
          scripts: [
            { type: "sig", keyHash: keyHashA },
            { type: "sig", keyHash: keyHashB },
            { type: "sig", keyHash: keyHashC },
          ],
        },
      ],
    };

    const serialized = serializeNativeScript(original, undefined, 0);
    expect(serialized.scriptCbor).toBeDefined();
    const scriptCbor = serialized.scriptCbor!;
    expect(typeof scriptCbor).toBe("string");
    expect(scriptCbor.length).toBeGreaterThan(0);

    const decoded = decodeNativeScriptFromCbor(scriptCbor);
    expect(decoded.type).toBe("all");
    expect(isHierarchicalScript(decoded)).toBe(true);

    const hashes = collectSigKeyHashes(decoded);
    expect(hashes).toEqual([
      keyHashA.toLowerCase(),
      keyHashB.toLowerCase(),
      keyHashC.toLowerCase(),
    ]);

    const ns = decodedToNativeScript(decoded) as any;
    expect(ns.type).toBe("all");
    expect(Array.isArray(ns.scripts)).toBe(true);
    expect(ns.scripts).toHaveLength(1);
    expect(ns.scripts[0].type).toBe("atLeast");
    expect(ns.scripts[0].required).toBe(2);
    expect(ns.scripts[0].scripts).toHaveLength(3);
  });
});

describe("countTotalSigs", () => {
  it("should count 1 for a single sig", () => {
    expect(countTotalSigs(sigA)).toBe(1);
  });

  it("should count all sigs in flat script", () => {
    expect(countTotalSigs(flatAll)).toBe(3);
  });

  it("should count sigs in hierarchical script", () => {
    expect(countTotalSigs(hierarchical)).toBe(3);
  });

  it("should count sigs in deeply nested script", () => {
    expect(countTotalSigs(deeplyNested)).toBe(2);
  });

  it("should return 0 for timelocks", () => {
    expect(countTotalSigs({ type: "timelockStart", slot: "0" })).toBe(0);
  });

  it("should count sigs including duplicates", () => {
    const dup: DecodedNativeScript = {
      type: "all",
      scripts: [sigA, sigA, sigB],
    };
    // countTotalSigs counts leaves, not unique hashes
    expect(countTotalSigs(dup)).toBe(3);
  });
});

describe("getScriptDepth", () => {
  it("should return 0 for a sig node", () => {
    expect(getScriptDepth(sigA)).toBe(0);
  });

  it("should return 1 for flat scripts", () => {
    expect(getScriptDepth(flatAll)).toBe(1);
    expect(getScriptDepth(flatAny)).toBe(1);
    expect(getScriptDepth(flatAtLeast)).toBe(1);
  });

  it("should return 2 for hierarchical script", () => {
    expect(getScriptDepth(hierarchical)).toBe(2);
  });

  it("should return 3 for deeply nested script", () => {
    expect(getScriptDepth(deeplyNested)).toBe(3);
  });

  it("should return 0 for timelocks", () => {
    expect(getScriptDepth({ type: "timelockStart", slot: "0" })).toBe(0);
  });
});
