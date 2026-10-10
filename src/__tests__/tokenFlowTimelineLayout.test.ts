import {
  ADDRESS_CARD_WIDTH,
  COLUMN_WIDTH,
  layoutTokenFlow,
  TIMELINE_COLUMN_WIDTH,
  TIMELINE_LANE_OFFSET,
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

/** Timeline (txOrder) layouts use the wider TIMELINE_COLUMN_WIDTH grid;
 *  pass COLUMN_WIDTH for default-mode results. */
function columnOf(
  result: ReturnType<typeof layoutTokenFlow>,
  id: string,
  width = TIMELINE_COLUMN_WIDTH,
): number {
  const node = result.nodes.find((n) => n.id === id)!;
  return node.position.x / width;
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
    expect(columnOf(defaultResult, "tx:one", COLUMN_WIDTH)).toBe(1);
    expect(columnOf(defaultResult, "tx:two", COLUMN_WIDTH)).toBe(1);

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

  test("external address bridging two events splits into lane cards, never on the line", () => {
    // tx:one pays B; tx:two spends from B. B is EXTERNAL, so it may not sit
    // ON the divider line: it renders as a received (@out) card left of the
    // line and a sending (@in) card right of it. Only self joins stay single.
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

    const bInstances = result.nodes
      .filter((n) => n.id.startsWith(`addr:${B}`))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(bInstances.map((n) => n.id)).toEqual([
      `addr:${B}@c2@in`,
      `addr:${B}@c2@out`,
    ]);
    // Received card settles left of the line, sending card enters right.
    const x = (id: string) => result.nodes.find((n) => n.id === id)!.position.x;
    expect(x(`addr:${B}@c2@out`)).toBe(2 * TIMELINE_COLUMN_WIDTH - TIMELINE_LANE_OFFSET);
    expect(x(`addr:${B}@c2@in`)).toBe(2 * TIMELINE_COLUMN_WIDTH + TIMELINE_LANE_OFFSET);
    // Edges rewire to the matching side.
    const output = result.edges.find((e) => e.data!.edge.kind === "output" && e.source === "tx:one")!;
    expect(output.target).toBe(`addr:${B}@c2@out`);
    const input = result.edges.find((e) => e.target === "tx:two")!;
    expect(input.source).toBe(`addr:${B}@c2@in`);

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

    // txLayer must cover UNLOADED ids too: the viewport controller keys its
    // visible-column demand off txLayer, and hash-only callers (no store
    // utxos) deadlock at the seeded batch if unloaded columns are
    // unaddressable (the /features demo bug).
    expect(partial.txLayer.get("tx:one")).toBe(0);
    expect(partial.txLayer.get("tx:two")).toBe(1);
    expect(partial.txLayer.get("tx:three")).toBe(2);
    expect(partial.txLayer.get("tx:four")).toBe(3);
    // ...while no phantom nodes are laid out for the unloaded ids.
    expect(partial.nodes.some((n) => n.id === "tx:one")).toBe(false);
    expect(partial.nodes.some((n) => n.id === "tx:two")).toBe(false);
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
    // one column, shortened by the lane offset when its address card is
    // shifted toward an event divider.
    const nodeX = new Map(result.nodes.map((n) => [n.id, n.position.x]));
    for (const edge of result.edges) {
      const kind = edge.data!.edge.kind;
      if (kind !== "input" && kind !== "output") continue;
      expect([
        TIMELINE_COLUMN_WIDTH,
        TIMELINE_COLUMN_WIDTH - TIMELINE_LANE_OFFSET,
      ]).toContain(nodeX.get(edge.target)! - nodeX.get(edge.source)!);
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
      expect(Math.abs(pill.position.x - tx.position.x)).toBeLessThan(
        TIMELINE_COLUMN_WIDTH / 2,
      );
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

describe("layoutTokenFlow — txOrder dividers & lanes", () => {
  /** tx:one (in: A; out: B, X) → tx:two (in: B, Y; out: C). B is the join;
   *  X is a spent-only output of tx:one; Y is a fresh sender into tx:two. */
  function boundaryFlows(): TokenFlow[] {
    const one: TokenFlow = {
      nodes: [
        { id: `addr:${A}`, kind: "address", address: A, partyType: "self" },
        { id: `addr:${B}`, kind: "address", address: B, partyType: "unknown" },
        { id: "addr:xxx", kind: "address", address: "xxx", partyType: "unknown" },
        { id: "tx:one", kind: "transaction", txHash: "one", status: "onchain", badges: [] },
      ],
      edges: [
        { id: `addr:${A}->tx:one:input`, source: `addr:${A}`, target: "tx:one", kind: "input", assets: [{ unit: "lovelace", quantity: "9" }] },
        { id: `tx:one->addr:${B}:output`, source: "tx:one", target: `addr:${B}`, kind: "output", assets: [{ unit: "lovelace", quantity: "5" }] },
        { id: "tx:one->addr:xxx:output", source: "tx:one", target: "addr:xxx", kind: "output", assets: [{ unit: "lovelace", quantity: "3" }] },
      ],
    };
    const two: TokenFlow = {
      nodes: [
        { id: `addr:${B}`, kind: "address", address: B, partyType: "unknown" },
        { id: "addr:yyy", kind: "address", address: "yyy", partyType: "unknown" },
        { id: `addr:${C}`, kind: "address", address: C, partyType: "unknown" },
        { id: "tx:two", kind: "transaction", txHash: "two", status: "onchain", badges: [] },
      ],
      edges: [
        { id: `addr:${B}->tx:two:input`, source: `addr:${B}`, target: "tx:two", kind: "input", assets: [{ unit: "lovelace", quantity: "5" }] },
        { id: "addr:yyy->tx:two:input", source: "addr:yyy", target: "tx:two", kind: "input", assets: [{ unit: "lovelace", quantity: "2" }] },
        { id: `tx:two->addr:${C}:output`, source: "tx:two", target: `addr:${C}`, kind: "output", assets: [{ unit: "lovelace", quantity: "6" }] },
      ],
    };
    return [one, two];
  }

  test("boundary column splits into left / right lanes around the divider", () => {
    const result = layoutTokenFlow(mergeTokenFlows(boundaryFlows()), {
      txOrder: ["tx:one", "tx:two"],
    });
    const x = (id: string) =>
      result.nodes.find((n) => n.id === id)!.position.x;

    // Boundary column 2: everything the left event produced settles left of
    // the line, everything entering the right event comes in from the
    // right. The external bridge B splits across both lanes — no external
    // card sits ON the line.
    expect(x("addr:xxx")).toBe(2 * TIMELINE_COLUMN_WIDTH - TIMELINE_LANE_OFFSET);
    expect(x(`addr:${B}@c2@out`)).toBe(2 * TIMELINE_COLUMN_WIDTH - TIMELINE_LANE_OFFSET);
    expect(x(`addr:${B}@c2@in`)).toBe(2 * TIMELINE_COLUMN_WIDTH + TIMELINE_LANE_OFFSET);
    expect(x("addr:yyy")).toBe(2 * TIMELINE_COLUMN_WIDTH + TIMELINE_LANE_OFFSET);
    // First and last columns have no boundary — unshifted.
    expect(x(`addr:${A}`)).toBe(0);
    expect(x(`addr:${C}`)).toBe(4 * TIMELINE_COLUMN_WIDTH);

    // The divider sits on the unshifted card centerline, and lane cards
    // keep clearance from it on both sides.
    expect(result.dividers).toEqual([
      { index: 0, x: 2 * TIMELINE_COLUMN_WIDTH + ADDRESS_CARD_WIDTH / 2 },
    ]);
    const lineX = result.dividers[0]!.x;
    expect(x("addr:xxx") + ADDRESS_CARD_WIDTH).toBeLessThan(lineX);
    expect(x(`addr:${B}@c2@out`) + ADDRESS_CARD_WIDTH).toBeLessThan(lineX);
    expect(x(`addr:${B}@c2@in`)).toBeGreaterThan(lineX);
    expect(x("addr:yyy")).toBeGreaterThan(lineX);
  });

  test("self cards never lane-shift: the wallet rides the divider line", () => {
    const SELF = "addr_test1self";
    const selfNode = { id: `addr:${SELF}`, kind: "address", address: SELF, partyType: "self" } as const;

    // Receiving-only: tx:one pays change to SELF (and X); SELF does not
    // spend into tx:two. SELF stays on the line while X settles left.
    const receiving = layoutTokenFlow(
      mergeTokenFlows([
        {
          nodes: [
            { id: `addr:${A}`, kind: "address", address: A, partyType: "unknown" },
            { id: "addr:xxx", kind: "address", address: "xxx", partyType: "unknown" },
            selfNode,
            { id: "tx:one", kind: "transaction", txHash: "one", status: "onchain", badges: [] },
          ],
          edges: [
            { id: `addr:${A}->tx:one:input`, source: `addr:${A}`, target: "tx:one", kind: "input", assets: [{ unit: "lovelace", quantity: "9" }] },
            { id: `tx:one->addr:${SELF}:output`, source: "tx:one", target: `addr:${SELF}`, kind: "output", assets: [{ unit: "lovelace", quantity: "5" }] },
            { id: "tx:one->addr:xxx:output", source: "tx:one", target: "addr:xxx", kind: "output", assets: [{ unit: "lovelace", quantity: "3" }] },
          ],
        },
        // Hand-built (simpleTxFlow marks its sender as partyType "self",
        // which would exempt B from the lane shift asserted below).
        {
          nodes: [
            { id: `addr:${B}`, kind: "address", address: B, partyType: "unknown" },
            { id: `addr:${C}`, kind: "address", address: C, partyType: "unknown" },
            { id: "tx:two", kind: "transaction", txHash: "two", status: "onchain", badges: [] },
          ],
          edges: [
            { id: `addr:${B}->tx:two:input`, source: `addr:${B}`, target: "tx:two", kind: "input", assets: [{ unit: "lovelace", quantity: "4" }] },
            { id: `tx:two->addr:${C}:output`, source: "tx:two", target: `addr:${C}`, kind: "output", assets: [{ unit: "lovelace", quantity: "3" }] },
          ],
        },
      ]),
      { txOrder: ["tx:one", "tx:two"] },
    );
    const rx = (id: string) => receiving.nodes.find((n) => n.id === id)!.position.x;
    expect(rx(`addr:${SELF}`)).toBe(2 * TIMELINE_COLUMN_WIDTH);
    expect(rx("addr:xxx")).toBe(2 * TIMELINE_COLUMN_WIDTH - TIMELINE_LANE_OFFSET);
    expect(rx(`addr:${B}`)).toBe(2 * TIMELINE_COLUMN_WIDTH + TIMELINE_LANE_OFFSET);

    // Sending-only: SELF spends older UTxOs into tx:two without receiving
    // from tx:one. SELF stays on the line while Y enters from the right.
    const sending = layoutTokenFlow(
      mergeTokenFlows([
        simpleTxFlow("one", A, B),
        {
          nodes: [
            selfNode,
            { id: "addr:yyy", kind: "address", address: "yyy", partyType: "unknown" },
            { id: `addr:${C}`, kind: "address", address: C, partyType: "unknown" },
            { id: "tx:two", kind: "transaction", txHash: "two", status: "onchain", badges: [] },
          ],
          edges: [
            { id: `addr:${SELF}->tx:two:input`, source: `addr:${SELF}`, target: "tx:two", kind: "input", assets: [{ unit: "lovelace", quantity: "4" }] },
            { id: "addr:yyy->tx:two:input", source: "addr:yyy", target: "tx:two", kind: "input", assets: [{ unit: "lovelace", quantity: "2" }] },
            { id: `tx:two->addr:${C}:output`, source: "tx:two", target: `addr:${C}`, kind: "output", assets: [{ unit: "lovelace", quantity: "5" }] },
          ],
        },
      ]),
      { txOrder: ["tx:one", "tx:two"] },
    );
    const sx = (id: string) => sending.nodes.find((n) => n.id === id)!.position.x;
    expect(sx(`addr:${SELF}`)).toBe(2 * TIMELINE_COLUMN_WIDTH);
    expect(sx("addr:yyy")).toBe(2 * TIMELINE_COLUMN_WIDTH + TIMELINE_LANE_OFFSET);
    expect(sx(`addr:${B}`)).toBe(2 * TIMELINE_COLUMN_WIDTH - TIMELINE_LANE_OFFSET);
  });

  test("a divider between every pair of consecutive loaded txs", () => {
    const result = layoutTokenFlow(
      mergeTokenFlows([
        simpleTxFlow("one", A, B),
        simpleTxFlow("two", B, C),
        simpleTxFlow("three", C, D),
      ]),
      { txOrder: ["tx:one", "tx:two", "tx:three"] },
    );
    expect(result.dividers).toEqual([
      { index: 0, x: 2 * TIMELINE_COLUMN_WIDTH + ADDRESS_CARD_WIDTH / 2 },
      { index: 1, x: 4 * TIMELINE_COLUMN_WIDTH + ADDRESS_CARD_WIDTH / 2 },
    ]);
  });

  test("no divider into unloaded gaps; lines appear as neighbours load without moving cards", () => {
    const txOrder = ["tx:one", "tx:two", "tx:three", "tx:four"];
    // Only a non-adjacent pair loaded: no divider at all.
    const sparse = layoutTokenFlow(
      mergeTokenFlows([simpleTxFlow("two", A, B), simpleTxFlow("four", C, D)]),
      { txOrder },
    );
    expect(sparse.dividers).toEqual([]);

    // An adjacent pair loaded: exactly that boundary gets its line.
    const partial = layoutTokenFlow(
      mergeTokenFlows([simpleTxFlow("three", A, B), simpleTxFlow("four", C, D)]),
      { txOrder },
    );
    expect(partial.dividers).toEqual([
      { index: 2, x: 6 * TIMELINE_COLUMN_WIDTH + ADDRESS_CARD_WIDTH / 2 },
    ]);

    const full = layoutTokenFlow(
      mergeTokenFlows([
        simpleTxFlow("one", "addr_test1eee", "addr_test1fff"),
        simpleTxFlow("two", "addr_test1ggg", "addr_test1hhh"),
        simpleTxFlow("three", A, B),
        simpleTxFlow("four", C, D),
      ]),
      { txOrder },
    );
    expect(full.dividers.map((d) => d.index)).toEqual([0, 1, 2]);
    // Lane offsets derive from the full txOrder list, so already-loaded
    // cards keep their exact x as the rest streams in.
    for (const id of [`addr:${A}`, `addr:${B}`, `addr:${C}`, `addr:${D}`]) {
      expect(partial.nodes.find((n) => n.id === id)!.position.x).toBe(
        full.nodes.find((n) => n.id === id)!.position.x,
      );
    }
  });

  test("no dividers for single-tx timelines or default mode", () => {
    const merged = mergeTokenFlows([simpleTxFlow("one", A, B)]);
    expect(layoutTokenFlow(merged, { txOrder: ["tx:one"] }).dividers).toEqual([]);
    expect(layoutTokenFlow(merged).dividers).toEqual([]);
  });

  test("bounds cover the full content extent including the protocol row", () => {
    const flow = simpleTxFlow("one", A, B);
    flow.nodes.push({ id: "protocol:fee", kind: "protocol", role: "fee", label: "Network fee" });
    flow.edges.push({ id: "tx:one->protocol:fee:fee", source: "tx:one", target: "protocol:fee", kind: "fee", assets: [{ unit: "lovelace", quantity: "1" }] });

    const result = layoutTokenFlow(flow, { txOrder: ["tx:one"] });
    expect(result.bounds.minY).toBe(0);
    for (const node of result.nodes) {
      expect(result.bounds.maxY).toBeGreaterThan(node.position.y);
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
    // A (external) is produced by "first" and consumed by "second": it
    // splits into a received card left of the event line and a sending
    // card right of it — only the wallet itself may sit ON the line.
    const xOf = (id: string) =>
      result.nodes.find((n) => n.id === id)!.position.x;
    expect(xOf(`addr:${A}@c2@out`)).toBe(
      2 * TIMELINE_COLUMN_WIDTH - TIMELINE_LANE_OFFSET,
    );
    expect(xOf(`addr:${A}@c2@in`)).toBe(
      2 * TIMELINE_COLUMN_WIDTH + TIMELINE_LANE_OFFSET,
    );
    expect(result.txLayer.get("tx:first")).toBe(0);
    expect(result.txLayer.get("tx:second")).toBe(1);
    expect(
      result.nodes.find((n) => n.id === "tx:first")!.data.testIdSuffix,
    ).toBe("-timeline");
  });
});
