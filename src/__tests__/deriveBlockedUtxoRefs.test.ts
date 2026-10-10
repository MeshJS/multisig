import { deriveBlockedUtxoRefs } from "@/utils/blockedUtxoRefs";

function pendingTx(id: string, refs: { txHash: string; txIndex: number }[]) {
  return {
    id,
    txJson: JSON.stringify({ inputs: refs.map((txIn) => ({ txIn })) }),
  };
}

describe("deriveBlockedUtxoRefs", () => {
  const HASH_A = "a".repeat(64);
  const HASH_B = "b".repeat(64);

  it("collects input refs from every pending transaction", () => {
    const refs = deriveBlockedUtxoRefs([
      pendingTx("tx-1", [{ txHash: HASH_A, txIndex: 0 }]),
      pendingTx("tx-2", [{ txHash: HASH_B, txIndex: 3 }]),
    ]);
    expect(refs).toEqual([
      { hash: HASH_A, index: 0 },
      { hash: HASH_B, index: 3 },
    ]);
  });

  it("frees the excluded transaction's inputs, keeping the rest blocked", () => {
    const refs = deriveBlockedUtxoRefs(
      [
        pendingTx("editing", [{ txHash: HASH_A, txIndex: 0 }]),
        pendingTx("other", [{ txHash: HASH_B, txIndex: 1 }]),
      ],
      "editing",
    );
    expect(refs).toEqual([{ hash: HASH_B, index: 1 }]);
  });

  it("tolerates malformed txJson and missing input refs", () => {
    const refs = deriveBlockedUtxoRefs([
      { id: "bad-json", txJson: "{not json" },
      { id: "no-inputs", txJson: JSON.stringify({}) },
      {
        id: "partial-ref",
        txJson: JSON.stringify({ inputs: [{ txIn: { txHash: HASH_A } }] }),
      },
      pendingTx("good", [{ txHash: HASH_B, txIndex: 2 }]),
    ]);
    expect(refs).toEqual([{ hash: HASH_B, index: 2 }]);
  });
});
