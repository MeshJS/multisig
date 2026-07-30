import type { OnChainTransaction } from "@/types/transaction";
import type { AddressLabeler } from "@/types/token-flow";
import {
  focusColumnRange,
  focusPair,
  orderTimelineTxs,
  storeTxToTokenFlow,
  timelineTxNodeId,
  timelineTxsFromOnChain,
  type TimelineTxRef,
} from "@/utils/token-flow";

function ref(overrides: Partial<TimelineTxRef> & { txHash: string }): TimelineTxRef {
  return { blockTime: 0, blockHeight: 0, txIndex: 0, ...overrides };
}

describe("orderTimelineTxs", () => {
  test("sorts oldest to newest by blockTime", () => {
    const sorted = orderTimelineTxs([
      ref({ txHash: "c", blockTime: 300 }),
      ref({ txHash: "a", blockTime: 100 }),
      ref({ txHash: "b", blockTime: 200 }),
    ]);
    expect(sorted.map((tx) => tx.txHash)).toEqual(["a", "b", "c"]);
  });

  test("does not mutate its input", () => {
    const txs = [
      ref({ txHash: "b", blockTime: 200 }),
      ref({ txHash: "a", blockTime: 100 }),
    ];
    orderTimelineTxs(txs);
    expect(txs.map((tx) => tx.txHash)).toEqual(["b", "a"]);
  });

  test("same blockTime: ties break by blockHeight, then txIndex, then hash", () => {
    const sorted = orderTimelineTxs([
      ref({ txHash: "later-block", blockTime: 100, blockHeight: 11 }),
      ref({ txHash: "earlier-block", blockTime: 100, blockHeight: 10 }),
    ]);
    expect(sorted.map((tx) => tx.txHash)).toEqual(["earlier-block", "later-block"]);

    // Two txs in the same block: block index decides.
    const sameBlock = orderTimelineTxs([
      ref({ txHash: "second", blockTime: 100, blockHeight: 10, txIndex: 3 }),
      ref({ txHash: "first", blockTime: 100, blockHeight: 10, txIndex: 1 }),
    ]);
    expect(sameBlock.map((tx) => tx.txHash)).toEqual(["first", "second"]);

    const identical = orderTimelineTxs([
      ref({ txHash: "bbb", blockTime: 100 }),
      ref({ txHash: "aaa", blockTime: 100 }),
    ]);
    expect(identical.map((tx) => tx.txHash)).toEqual(["aaa", "bbb"]);
  });
});

describe("timelineTxsFromOnChain", () => {
  const onChain: OnChainTransaction[] = [
    {
      hash: "hash1",
      tx: { block_height: 10, block_time: 1000, tx_hash: "hash1", tx_index: 2 },
      inputs: [],
      outputs: [],
    },
    {
      hash: "hash2",
      tx: { block_height: 20, block_time: 2000, tx_hash: "hash2", tx_index: 0 },
      inputs: [],
      outputs: [],
    },
  ];

  test("maps store shape to timeline refs, joining descriptions by hash", () => {
    const refs = timelineTxsFromOnChain(
      onChain,
      new Map([["hash1", "Payroll run"]]),
    );
    expect(refs).toEqual([
      {
        txHash: "hash1",
        blockTime: 1000,
        blockHeight: 10,
        txIndex: 2,
        description: "Payroll run",
        utxos: { inputs: [], outputs: [] },
      },
      {
        txHash: "hash2",
        blockTime: 2000,
        blockHeight: 20,
        txIndex: 0,
        description: undefined,
        utxos: { inputs: [], outputs: [] },
      },
    ]);
  });

  test("works without descriptions; null descriptions become undefined", () => {
    expect(timelineTxsFromOnChain(onChain)[0]!.description).toBeUndefined();
    const refs = timelineTxsFromOnChain(onChain, new Map([["hash1", null]]));
    expect(refs[0]!.description).toBeUndefined();
  });
});

describe("storeTxToTokenFlow", () => {
  const SELF = "addr_test1self";
  const OTHER = "addr_test1other";
  const labelAddress: AddressLabeler = (address) =>
    address === SELF
      ? { label: "Self (Multisig)", type: "self" }
      : { label: "", type: "unknown" };

  test("builds an instant flow from store inputs/outputs with matching tx node id", () => {
    const flow = storeTxToTokenFlow(
      ref({
        txHash: "abc123",
        blockHeight: 42,
        description: "Payroll run",
        utxos: {
          inputs: [
            { address: SELF, amount: [{ unit: "lovelace", quantity: "2000000" }], output_index: 0 },
            { address: SELF, amount: [{ unit: "lovelace", quantity: "3000000" }], output_index: 1 },
          ],
          outputs: [
            { address: OTHER, amount: [{ unit: "lovelace", quantity: "4800000" }], output_index: 0 },
          ],
        },
      }),
      { labelAddress },
    );

    // Same id shape as onChainTxToTokenFlow, so the detail flow replaces
    // this one seamlessly when the fetch lands.
    expect(flow.nodes.find((n) => n.kind === "transaction")).toMatchObject({
      id: "tx:abc123",
      status: "onchain",
      label: "Payroll run",
      blockHeight: 42,
      badges: [],
    });
    // Inputs aggregate per address (the store drops source-UTxO refs).
    const inputs = flow.edges.filter((e) => e.kind === "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      source: `addr:${SELF}`,
      target: "tx:abc123",
      assets: [{ unit: "lovelace", quantity: "5000000" }],
    });
    expect(flow.edges.filter((e) => e.kind === "output")).toHaveLength(1);
    // No detail-only edges without the tx info endpoint.
    expect(flow.edges.some((e) => e.kind === "fee")).toBe(false);
    expect(flow.nodes.find((n) => n.id === `addr:${SELF}`)).toMatchObject({
      label: "Self (Multisig)",
      partyType: "self",
    });
  });

  test("ref without utxos yields a lone transaction node", () => {
    const flow = storeTxToTokenFlow(ref({ txHash: "abc123" }), { labelAddress });
    expect(flow.nodes).toHaveLength(1);
    expect(flow.edges).toHaveLength(0);
  });
});

describe("focusPair", () => {
  const ids = ["tx:a", "tx:b", "tx:c", "tx:d"];

  test("newest focus is the last two ids", () => {
    expect(focusPair(ids, 3)).toEqual(["tx:c", "tx:d"]);
  });

  test("stepping back moves the window one tx at a time", () => {
    expect(focusPair(ids, 2)).toEqual(["tx:b", "tx:c"]);
    expect(focusPair(ids, 1)).toEqual(["tx:a", "tx:b"]);
  });

  test("clamps at the old end and out-of-range indices", () => {
    expect(focusPair(ids, 0)).toEqual(["tx:a"]);
    expect(focusPair(ids, -5)).toEqual(["tx:a"]);
    expect(focusPair(ids, 99)).toEqual(["tx:c", "tx:d"]);
  });

  test("single tx and empty list", () => {
    expect(focusPair(["tx:only"], 0)).toEqual(["tx:only"]);
    expect(focusPair([], 0)).toEqual([]);
  });
});

describe("focusColumnRange", () => {
  const txLayer = new Map([
    ["tx:a", 0],
    ["tx:b", 1],
    ["tx:c", 5],
  ]);

  test("spans input column of the oldest through output column of the newest", () => {
    expect(focusColumnRange(txLayer, ["tx:a", "tx:b"])).toEqual({
      minCol: 0,
      maxCol: 4,
    });
    // Gapped layers (unloaded txs between) still produce a contiguous band.
    expect(focusColumnRange(txLayer, ["tx:b", "tx:c"])).toEqual({
      minCol: 2,
      maxCol: 12,
    });
  });

  test("single tx: its own three columns", () => {
    expect(focusColumnRange(txLayer, ["tx:b"])).toEqual({ minCol: 2, maxCol: 4 });
  });

  test("unknown ids are ignored; no known ids yields undefined", () => {
    expect(focusColumnRange(txLayer, ["tx:a", "tx:unknown"])).toEqual({
      minCol: 0,
      maxCol: 2,
    });
    expect(focusColumnRange(txLayer, ["tx:unknown"])).toBeUndefined();
    expect(focusColumnRange(txLayer, [])).toBeUndefined();
  });

  test("timelineTxNodeId matches the on-chain adapter's tx node id shape", () => {
    expect(timelineTxNodeId("abc123")).toBe("tx:abc123");
  });
});
