import { describe, expect, it } from "@jest/globals";
import type { UTxO } from "@meshsdk/core";
import { resolveUtxoRefsFromChain } from "@/lib/server/resolveUtxoRefsFromChain";

const mkUtxo = (addr: string, txHash = "ab", idx = 0): UTxO =>
  ({
    input: { txHash, outputIndex: idx },
    output: { address: addr, amount: [{ unit: "lovelace", quantity: "3000000" }] },
  }) as UTxO;

describe("resolveUtxoRefsFromChain", () => {
  it("rejects empty utxoRefs", async () => {
    const r = await resolveUtxoRefsFromChain({
      network: 0,
      utxoRefs: [],
      expectedSpendAddress: "addr1test",
      provider: { fetchUTxOs: async () => [] },
    });
    expect("error" in r && r.status === 400).toBe(true);
  });

  it("rejects when output address does not match spend address", async () => {
    const r = await resolveUtxoRefsFromChain({
      network: 0,
      utxoRefs: [{ txHash: "aa", outputIndex: 0 }],
      expectedSpendAddress: "addr_expected",
      provider: {
        fetchUTxOs: async () => [mkUtxo("addr_other", "aa", 0)],
      },
    });
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toContain("multisig spend address");
    }
  });

  it("returns utxos when address matches", async () => {
    const addr = "addr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
    const r = await resolveUtxoRefsFromChain({
      network: 0,
      utxoRefs: [{ txHash: "aa", outputIndex: 1 }],
      expectedSpendAddress: addr,
      provider: {
        fetchUTxOs: async (hash, index) => {
          expect(hash).toBe("aa");
          expect(index).toBe(1);
          return [mkUtxo(addr, "aa", 1)];
        },
      },
    });
    expect("utxos" in r && r.utxos.length === 1).toBe(true);
  });
});
