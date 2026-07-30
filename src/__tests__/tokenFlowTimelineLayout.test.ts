import {
  COLUMN_WIDTH,
  layoutTokenFlow,
} from "@/components/common/token-flow/layout";
import { mergeTokenFlows, onChainTxToTokenFlow } from "@/utils/token-flow";
import type { BlockfrostTxInfo, TxFlowData } from "@/types/blockfrost";
import type { AddressLabeler, TokenFlow } from "@/types/token-flow";

const A = "addr_test1aaa";
const B = "addr_test1bbb";
const C = "addr_test1ccc";
const D = "addr_test1ddd";

/** Single tx spending from `from` and paying `to`, no shared addresses. */
function simpleTxFlow(txId: string, from: string, to: string): TokenFlow {
  return {
    nodes: [
      { id: `addr:${from}`, kind: "address", address: from, partyType: "self" },
      { id: `addr:${to}`, kind: "address", address: to, partyType: "unknown" },
      { id: `tx:${txId}`, kind: "transaction", txHash: txId, status: "onchain", badges: [] },
    ],
    edges: [
      { id: `addr:${from}->tx:${txId}:input`, source: `addr:${from}`, target: `tx:${txId}`, kind: "input", assets: [{ unit: "lovelace", quantity: "5" }] },
      { id: `tx:${txId}->addr:${to}:output`, source: `tx:${txId}`, target: `addr:${to}`, kind: "output", assets: [{ unit: "lovelace", quantity: "4" }] },
    ],
  };
}

function columnOf(result: ReturnType<typeof layoutTokenFlow>, id: string): number {
  const node = result.nodes.find((n) => n.id === id)!;
  return node.position.x / COLUMN_WIDTH;
}

describe("layoutTokenFlow — txOrder timeline layering", () => {
  test("independent txs get distinct ascending layers in the given order", () => {
    // Without txOrder these two txs share no addresses and both land in
    // layer 0; the timeline option is precisely what separates them.
    const merged = mergeTokenFlows([
      simpleTxFlow("one", A, B),
      simpleTxFlow("two", C, D),
    ]);
    const defaultResult = layoutTokenFlow(merged);
    expect(columnOf(defaultResult, "tx:one")).toBe(1);
    expect(columnOf(defaultResult, "tx:two")).toBe(1);

    const result = layoutTokenFlow(merged, { txOrder: ["tx:one", "tx:two"] });
    expect(columnOf(result, "tx:one")).toBe(1);
    expect(columnOf(result, "tx:two")).toBe(3);
    expect(result.txLayer.get("tx:one")).toBe(0);
    expect(result.txLayer.get("tx:two")).toBe(1);

    // Order is taken from txOrder, not from dependency analysis.
    const reversed = layoutTokenFlow(merged, { txOrder: ["tx:two", "tx:one"] });
    expect(columnOf(reversed, "tx:two")).toBe(1);
    expect(columnOf(reversed, "tx:one")).toBe(3);
  });

  test("dependency join preserved: shared address stays a single join node", () => {
    // tx:one pays B; tx:two spends from B — chronological order agrees with
    // dependency order (consuming requires confirmation), so the join keeps
    // working exactly as in the default layout.
    const txTwo: TokenFlow = {
      nodes: [
        { id: `addr:${B}`, kind: "address", address: B, partyType: "unknown" },
        { id: `addr:${C}`, kind: "address", address: C, partyType: "unknown" },
        { id: "tx:two", kind: "transaction", txHash: "two", status: "onchain", badges: [] },
      ],
      edges: [
        { id: `addr:${B}->tx:two:input`, source: `addr:${B}`, target: "tx:two", kind: "input", assets: [{ unit: "lovelace", quantity: "4" }] },
        { id: `tx:two->addr:${C}:output`, source: "tx:two", target: `addr:${C}`, kind: "output", assets: [{ unit: "lovelace", quantity: "3" }] },
      ],
    };
    const merged = mergeTokenFlows([simpleTxFlow("one", A, B), txTwo]);
    const result = layoutTokenFlow(merged, { txOrder: ["tx:one", "tx:two"] });

    const bInstances = result.nodes.filter((n) => n.id.startsWith(`addr:${B}`));
    expect(bInstances.map((n) => n.id)).toEqual([`addr:${B}`]);
    expect(columnOf(result, "tx:one")).toBe(1);
    expect(columnOf(result, `addr:${B}`)).toBe(2);
    expect(columnOf(result, "tx:two")).toBe(3);

    // No value edge flows backwards under explicit ordering either.
    const nodeX = new Map(result.nodes.map((n) => [n.id, n.position.x]));
    for (const edge of result.edges) {
      const kind = edge.data!.edge.kind;
      if (kind !== "input" && kind !== "output") continue;
      expect(nodeX.get(edge.source)!).toBeLessThan(nodeX.get(edge.target)!);
    }
  });

  test("ids missing from the flow keep their index: loaded positions are stable", () => {
    // Timeline passes the FULL chronological list as txOrder while data for
    // older txs is still loading; loaded txs must not move when the rest
    // arrives.
    const txOrder = ["tx:one", "tx:two", "tx:three", "tx:four"];
    const partial = layoutTokenFlow(
      mergeTokenFlows([simpleTxFlow("three", A, B), simpleTxFlow("four", C, D)]),
      { txOrder },
    );
    const full = layoutTokenFlow(
      mergeTokenFlows([
        simpleTxFlow("one", "addr_test1eee", "addr_test1fff"),
        simpleTxFlow("two", "addr_test1ggg", "addr_test1hhh"),
        simpleTxFlow("three", A, B),
        simpleTxFlow("four", C, D),
      ]),
      { txOrder },
    );
    for (const id of ["tx:three", "tx:four", `addr:${A}`, `addr:${C}`]) {
      expect(partial.nodes.find((n) => n.id === id)!.position.x).toBe(
        full.nodes.find((n) => n.id === id)!.position.x,
      );
    }
    expect(columnOf(partial, "tx:three")).toBe(5);
    expect(columnOf(partial, "tx:four")).toBe(7);
  });

  test("shared wallet address renders as per-column instances, not full-width fans", () => {
    // Both txs spend from A and pay change back to A (the multisig self
    // address pattern). A single global @in/@out instance pair would fan
    // edges across the whole timeline; per-column instancing keeps every
    // value edge exactly one column long.
    function selfSpendFlow(txId: string, other: string): TokenFlow {
      return {
        nodes: [
          { id: `addr:${A}`, kind: "address", address: A, partyType: "self" },
          { id: `addr:${other}`, kind: "address", address: other, partyType: "unknown" },
          { id: `tx:${txId}`, kind: "transaction", txHash: txId, status: "onchain", badges: [] },
        ],
        edges: [
          { id: `addr:${A}->tx:${txId}:input`, source: `addr:${A}`, target: `tx:${txId}`, kind: "input", assets: [{ unit: "lovelace", quantity: "9" }] },
          { id: `tx:${txId}->addr:${other}:output`, source: `tx:${txId}`, target: `addr:${other}`, kind: "output", assets: [{ unit: "lovelace", quantity: "4" }] },
          { id: `tx:${txId}->addr:${A}:output`, source: `tx:${txId}`, target: `addr:${A}`, kind: "output", assets: [{ unit: "lovelace", quantity: "5" }] },
        ],
      };
    }
    const merged = mergeTokenFlows([selfSpendFlow("one", B), selfSpendFlow("two", C)]);
    const result = layoutTokenFlow(merged, { txOrder: ["tx:one", "tx:two"] });

    // A appears once per column it touches: input of tx:one (col 0), the
    // change/join between the txs (col 2), and change of tx:two (col 4).
    const aInstances = result.nodes
      .filter((n) => n.id.startsWith(`addr:${A}`))
      .sort((a, b) => a.position.x - b.position.x);
    expect(aInstances.map((n) => n.id)).toEqual([
      `addr:${A}@c0`,
      `addr:${A}@c2`,
      `addr:${A}@c4`,
    ]);
    // The middle instance is tx:one's change AND tx:two's input — a join.
    expect(aInstances[1]!.data.changeHint).toBe(true);
    expect(aInstances[2]!.data.changeHint).toBe(true);

    // The invariant that kills the full-width fans: every value edge spans
    // exactly one column.
    const nodeX = new Map(result.nodes.map((n) => [n.id, n.position.x]));
    for (const edge of result.edges) {
      const kind = edge.data!.edge.kind;
      if (kind !== "input" && kind !== "output") continue;
      expect(nodeX.get(edge.target)! - nodeX.get(edge.source)!).toBe(COLUMN_WIDTH);
    }
  });

  test("each tx gets its own fee pill directly beneath it", () => {
    function feeTxFlow(txId: string, from: string, to: string): TokenFlow {
      const flow = simpleTxFlow(txId, from, to);
      flow.nodes.push({ id: "protocol:fee", kind: "protocol", role: "fee", label: "Network fee" });
      flow.edges.push({
        id: `tx:${txId}->protocol:fee:fee`,
        source: `tx:${txId}`,
        target: "protocol:fee",
        kind: "fee",
        assets: [{ unit: "lovelace", quantity: "1" }],
      });
      return flow;
    }
    const merged = mergeTokenFlows([feeTxFlow("one", A, B), feeTxFlow("two", C, D)]);
    const result = layoutTokenFlow(merged, { txOrder: ["tx:one", "tx:two"] });

    // The shared singleton splits into one pill per tx, each anchored to
    // its own tx column instead of the timeline's midpoint.
    expect(result.nodes.find((n) => n.id === "protocol:fee")).toBeUndefined();
    const pills = result.nodes.filter((n) => n.id.startsWith("protocol:fee@"));
    expect(pills.map((n) => n.id).sort()).toEqual([
      "protocol:fee@c1",
      "protocol:fee@c3",
    ]);
    for (const pill of pills) {
      const txId = pill.id === "protocol:fee@c1" ? "tx:one" : "tx:two";
      const tx = result.nodes.find((n) => n.id === txId)!;
      expect(Math.abs(pill.position.x - tx.position.x)).toBeLessThan(COLUMN_WIDTH / 2);
      expect(pill.position.y).toBeGreaterThan(tx.position.y);
      expect(pill.data.usedProtoHandles).toEqual(["top-in"]);
    }
    // Each fee edge targets its own tx's pill.
    const feeEdges = result.edges.filter((e) => e.data!.edge.kind === "fee");
    expect(
      feeEdges.map((e) => [e.source, e.target]).sort(),
    ).toEqual([
      ["tx:one", "protocol:fee@c1"],
      ["tx:two", "protocol:fee@c3"],
    ]);
  });

  test("txs not listed in txOrder fall back to layer 0", () => {
    const merged = mergeTokenFlows([
      simpleTxFlow("one", A, B),
      simpleTxFlow("two", C, D),
    ]);
    const result = layoutTokenFlow(merged, { txOrder: ["tx:two"] });
    expect(columnOf(result, "tx:one")).toBe(1);
    expect(columnOf(result, "tx:two")).toBe(1);
  });

  test("testIdSuffix is stamped into every node's data", () => {
    const flow = simpleTxFlow("one", A, B);
    flow.nodes.push({ id: "protocol:fee", kind: "protocol", role: "fee", label: "Network fee" });
    flow.edges.push({ id: "tx:one->protocol:fee:fee", source: "tx:one", target: "protocol:fee", kind: "fee", assets: [{ unit: "lovelace", quantity: "1" }] });

    const result = layoutTokenFlow(flow, { testIdSuffix: "-timeline" });
    for (const node of result.nodes) {
      expect(node.data.testIdSuffix).toBe("-timeline");
    }
    const plain = layoutTokenFlow(flow);
    for (const node of plain.nodes) {
      expect(node.data.testIdSuffix).toBeUndefined();
    }
  });
});

describe("timeline integration: on-chain adapters → merge → ordered layout", () => {
  const SELF = "addr_test1self";
  const labelAddress: AddressLabeler = (address) =>
    address === SELF
      ? { label: "Self (Multisig)", type: "self" }
      : { label: "", type: "unknown" };

  function info(hash: string, blockTime: number): BlockfrostTxInfo {
    return {
      hash,
      block_height: 100,
      block_time: blockTime,
      fees: "200000",
      deposit: "0",
      valid_contract: true,
      withdrawal_count: 0,
      delegation_count: 0,
      stake_cert_count: 0,
      pool_update_count: 0,
      pool_retire_count: 0,
      asset_mint_or_burn_count: 0,
      redeemer_count: 0,
    };
  }
  function input(address: string, quantity: string, outputIndex = 0) {
    return {
      address,
      amount: [{ unit: "lovelace", quantity }],
      output_index: outputIndex,
      tx_hash: "prev",
      collateral: false,
      reference: false,
      data_hash: null,
    };
  }
  function output(address: string, quantity: string) {
    return {
      address,
      amount: [{ unit: "lovelace", quantity }],
      output_index: 0,
      data_hash: null,
      collateral: false,
    };
  }

  test("chained payments lay out chronologically with a shared join", () => {
    // tx "first": SELF pays A. tx "second": A pays B.
    const first: TxFlowData = {
      info: info("first", 1000),
      utxos: {
        hash: "first",
        inputs: [input(SELF, "5000000")],
        outputs: [output(A, "4800000")],
      },
    };
    const second: TxFlowData = {
      info: info("second", 2000),
      utxos: {
        hash: "second",
        inputs: [input(A, "4800000")],
        outputs: [output(B, "4600000")],
      },
    };
    const merged = mergeTokenFlows([
      onChainTxToTokenFlow(first, { labelAddress, description: "Fund A" }),
      onChainTxToTokenFlow(second, { labelAddress }),
    ]);
    const result = layoutTokenFlow(merged, {
      txOrder: ["tx:first", "tx:second"],
      testIdSuffix: "-timeline",
    });

    expect(columnOf(result, "tx:first")).toBe(1);
    expect(columnOf(result, "tx:second")).toBe(3);
    // A is produced by "first" and consumed by "second": a single join node
    // between the two transactions.
    expect(columnOf(result, `addr:${A}`)).toBe(2);
    expect(result.txLayer.get("tx:first")).toBe(0);
    expect(result.txLayer.get("tx:second")).toBe(1);
    expect(
      result.nodes.find((n) => n.id === "tx:first")!.data.testIdSuffix,
    ).toBe("-timeline");
  });
});
