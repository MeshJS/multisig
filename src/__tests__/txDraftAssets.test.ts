import { describe, expect, it } from "@jest/globals";
import type { UTxO } from "@meshsdk/core";

import type { TxDraft } from "@/types/tx-draft";
import {
  MIN_TOKEN_OUTPUT_LOVELACE,
  materializeOutputAssets,
  requiredAssetTotals,
  safeBigInt,
  utxoFunds,
} from "@/lib/tx-draft/assets";

function draft(outputs: TxDraft["outputs"]): TxDraft {
  return {
    id: "draft-1",
    outputs,
    utxoSelection: { mode: "auto" },
    description: "",
    metadata: "",
    certificates: [],
    votes: [],
  };
}

function utxo(amount: { unit: string; quantity: string }[]): UTxO {
  return {
    input: { txHash: "00".repeat(32), outputIndex: 0 },
    output: { address: "addr_test1x", amount },
  };
}

describe("safeBigInt", () => {
  it("parses BigInt-safe strings including negatives", () => {
    expect(safeBigInt("0")).toBe(0n);
    expect(safeBigInt("1160000")).toBe(1160000n);
    expect(safeBigInt("-5")).toBe(-5n);
  });

  it("returns undefined instead of throwing on junk", () => {
    expect(safeBigInt("")).toBe(0n); // BigInt("") === 0n
    expect(safeBigInt("1.5")).toBeUndefined();
    expect(safeBigInt("abc")).toBeUndefined();
  });
});

describe("materializeOutputAssets", () => {
  it("leaves an empty asset list empty", () => {
    expect(materializeOutputAssets([])).toEqual([]);
  });

  it("keeps outputs that already carry lovelace unchanged", () => {
    const assets = [
      { unit: "lovelace", quantity: "2000000" },
      { unit: "token.a", quantity: "5" },
    ];
    expect(materializeOutputAssets(assets)).toBe(assets);
  });

  it("tops up token-only outputs with the min-ADA constant", () => {
    expect(materializeOutputAssets([{ unit: "token.a", quantity: "5" }])).toEqual([
      { unit: "token.a", quantity: "5" },
      { unit: "lovelace", quantity: MIN_TOKEN_OUTPUT_LOVELACE.toString() },
    ]);
  });
});

describe("requiredAssetTotals", () => {
  it("sums assets across outputs including min-ADA top-ups", () => {
    const totals = requiredAssetTotals(
      draft([
        {
          id: "o1",
          address: "addr_test1a",
          assets: [{ unit: "lovelace", quantity: "2000000" }],
        },
        {
          id: "o2",
          address: "addr_test1b",
          assets: [{ unit: "token.a", quantity: "5" }],
        },
        {
          id: "o3",
          address: "addr_test1c",
          assets: [{ unit: "token.a", quantity: "3" }],
        },
      ]),
    );

    expect(totals.get("token.a")).toBe(8n);
    // 2 ADA drafted + two token-only top-ups.
    expect(totals.get("lovelace")).toBe(2000000n + 2n * MIN_TOKEN_OUTPUT_LOVELACE);
  });

  it("skips unparseable quantities and returns an empty map for an empty draft", () => {
    const totals = requiredAssetTotals(
      draft([
        {
          id: "o1",
          address: "addr_test1a",
          assets: [
            { unit: "lovelace", quantity: "junk" },
            { unit: "token.a", quantity: "2" },
          ],
        },
      ]),
    );
    expect(totals.get("lovelace")).toBeUndefined();
    expect(totals.get("token.a")).toBe(2n);

    expect(requiredAssetTotals(draft([])).size).toBe(0);
  });
});

describe("utxoFunds", () => {
  it("sums held assets across UTxOs by unit", () => {
    const funds = utxoFunds([
      utxo([
        { unit: "lovelace", quantity: "3000000" },
        { unit: "token.a", quantity: "1" },
      ]),
      utxo([{ unit: "lovelace", quantity: "1000000" }]),
    ]);
    expect(funds.get("lovelace")).toBe(4000000n);
    expect(funds.get("token.a")).toBe(1n);
  });

  it("ignores unparseable quantities", () => {
    const funds = utxoFunds([utxo([{ unit: "lovelace", quantity: "junk" }])]);
    expect(funds.size).toBe(0);
  });
});
