import { describe, expect, it } from "@jest/globals";
import type { UTxO } from "@meshsdk/core";
import {
  MAX_UTXO_REFS,
  parseUtxoRef,
  resolveUtxoRefsFromChain,
  type UtxoFetcher,
} from "@/lib/server/resolveUtxoRefsFromChain";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const SPEND = "addr_test1_wallet_script";

const mkUtxo = (addr: string, txHash = HASH_A, idx = 0): UTxO =>
  ({
    input: { txHash, outputIndex: idx },
    output: { address: addr, amount: [{ unit: "lovelace", quantity: "3000000" }] },
  }) as UTxO;

/** Records every upstream call; each tx has `outputs` outputs at `address`. */
function recordingProvider(outputs = 3, address = SPEND) {
  const calls: Array<{ hash: string; index?: number }> = [];
  const provider: UtxoFetcher = {
    fetchUTxOs: async (hash, index) => {
      calls.push({ hash, index });
      return Array.from({ length: outputs }, (_, i) => mkUtxo(address, hash, i));
    },
  };
  return { calls, provider };
}

const resolve = (utxoRefs: unknown, provider: UtxoFetcher) =>
  resolveUtxoRefsFromChain({
    network: 0,
    utxoRefs: utxoRefs as { txHash: string; outputIndex: number }[],
    expectedSpendAddress: SPEND,
    provider,
  });

describe("parseUtxoRef", () => {
  it("accepts a 64-hex hash and a non-negative integer index, canonicalised", () => {
    expect(parseUtxoRef({ txHash: HASH_A, outputIndex: 0 })).toEqual({ txHash: HASH_A, outputIndex: 0 });
    expect(parseUtxoRef({ txHash: ` ${"AB".repeat(32)} `, outputIndex: 7 })).toEqual({
      txHash: "ab".repeat(32),
      outputIndex: 7,
    });
  });

  it("rejects anything that is not a transaction hash — it becomes a Blockfrost URL path", () => {
    for (const txHash of [
      "aa",
      "",
      `${HASH_A}a`,
      `${"g".repeat(64)}`,
      "../accounts/stake_test1uqxyz",
      `${HASH_A.slice(0, 60)}/../`,
      `${HASH_A}?x=1`,
      42,
      undefined,
    ]) {
      expect(parseUtxoRef({ txHash, outputIndex: 0 })).toBeNull();
    }
  });

  it("rejects negative, fractional, non-numeric and unsafe indices, and non-objects", () => {
    for (const outputIndex of [-1, 1.5, "0", NaN, Infinity, 2 ** 53, undefined]) {
      expect(parseUtxoRef({ txHash: HASH_A, outputIndex })).toBeNull();
    }
    expect(parseUtxoRef(null)).toBeNull();
    expect(parseUtxoRef("aa#0")).toBeNull();
  });
});

describe("resolveUtxoRefsFromChain", () => {
  it("rejects a missing or empty utxoRefs array", async () => {
    const { provider, calls } = recordingProvider();
    for (const refs of [[], undefined, { txHash: HASH_A, outputIndex: 0 }]) {
      expect(await resolve(refs, provider)).toEqual({
        error: "utxoRefs must be a non-empty array",
        status: 400,
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("rejects more refs than any transaction could spend, without calling the chain", async () => {
    const { provider, calls } = recordingProvider();
    const refs = Array.from({ length: MAX_UTXO_REFS + 1 }, (_, i) => ({ txHash: HASH_A, outputIndex: i }));
    const result = await resolve(refs, provider);
    expect(result).toEqual({ error: expect.stringContaining(`at most ${MAX_UTXO_REFS}`), status: 400 });
    expect(calls).toHaveLength(0);
  });

  it("the cap sits at the 16 KiB transaction-size limit, well above any real request", () => {
    // 36 bytes per input is a lower bound, so this many inputs alone fill a tx.
    expect(MAX_UTXO_REFS * 36).toBeLessThanOrEqual(16 * 1024);
    expect(MAX_UTXO_REFS).toBeGreaterThanOrEqual(400);
  });

  it("validates every ref before the first chain call and names the bad one", async () => {
    const { provider, calls } = recordingProvider();
    const result = await resolve(
      [
        { txHash: HASH_A, outputIndex: 0 },
        { txHash: "../addresses/addr_test1", outputIndex: 0 },
      ],
      provider,
    );
    expect(result).toEqual({ error: expect.stringContaining("Invalid utxoRefs[1]"), status: 400 });
    expect(calls).toHaveLength(0);
  });

  it("rejects the same UTxO twice, even when spelled in a different case", async () => {
    const { provider, calls } = recordingProvider();
    const result = await resolve(
      [
        { txHash: HASH_A, outputIndex: 1 },
        { txHash: HASH_B, outputIndex: 0 },
        { txHash: HASH_A.toUpperCase(), outputIndex: 1 },
      ],
      provider,
    );
    expect(result).toEqual({ error: `utxoRefs[2] repeats ${HASH_A}#1`, status: 400 });
    expect(calls).toHaveLength(0);
  });

  it("fetches each transaction once, however many of its outputs are named", async () => {
    const { provider, calls } = recordingProvider(3);
    const result = await resolve(
      [
        { txHash: HASH_A, outputIndex: 2 },
        { txHash: HASH_B, outputIndex: 0 },
        { txHash: HASH_A, outputIndex: 0 },
      ],
      provider,
    );
    expect(calls.map((c) => c.hash)).toEqual([HASH_A, HASH_B]);
    expect("utxos" in result && result.utxos.map((u) => `${u.input.txHash}#${u.input.outputIndex}`)).toEqual([
      `${HASH_A}#2`,
      `${HASH_B}#0`,
      `${HASH_A}#0`,
    ]);
  });

  it("returns refs in canonical lowercase form to the builder", async () => {
    const { provider, calls } = recordingProvider(1);
    const result = await resolve([{ txHash: HASH_A.toUpperCase(), outputIndex: 0 }], provider);
    expect(calls[0]!.hash).toBe(HASH_A);
    expect("utxos" in result && result.utxos[0]!.input.txHash).toBe(HASH_A);
  });

  it("400s when the transaction exists but has no such output", async () => {
    const { provider } = recordingProvider(2);
    expect(await resolve([{ txHash: HASH_A, outputIndex: 5 }], provider)).toEqual({
      error: `UTxO not found or already spent: ${HASH_A}#5`,
      status: 400,
    });
  });

  it("400s when the provider cannot find the transaction", async () => {
    const result = await resolve([{ txHash: HASH_A, outputIndex: 0 }], {
      fetchUTxOs: async () => {
        throw new Error("404");
      },
    });
    expect(result).toEqual({
      error: expect.stringContaining(`UTxO not found or not yet available: ${HASH_A}#0`),
      status: 400,
    });
  });

  it("rejects when output address does not match spend address", async () => {
    const { provider } = recordingProvider(1, "addr_other");
    const r = await resolve([{ txHash: HASH_A, outputIndex: 0 }], provider);
    expect(r).toEqual({ error: expect.stringContaining("multisig spend address"), status: 400 });
  });
});
