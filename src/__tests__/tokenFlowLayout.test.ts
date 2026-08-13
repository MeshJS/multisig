import {
  COLUMN_WIDTH,
  layoutTokenFlow,
} from "@/components/common/token-flow/layout";
import { HANDLES } from "@/components/common/token-flow/handles";
import { mergeTokenFlows } from "@/utils/token-flow";
import type { TokenFlow } from "@/types/token-flow";

const A = "addr_test1aaa";
const B = "addr_test1bbb";
const C = "addr_test1ccc";

function singleTxFlow(): TokenFlow {
  return {
    nodes: [
      { id: `addr:${A}`, kind: "address", address: A, partyType: "self" },
      { id: `addr:${B}`, kind: "address", address: B, partyType: "unknown" },
      { id: "tx:one", kind: "transaction", txHash: "one", status: "onchain", badges: [] },
      { id: "protocol:fee", kind: "protocol", role: "fee", label: "Network fee" },
    ],
    edges: [
      { id: `addr:${A}->tx:one:input`, source: `addr:${A}`, target: "tx:one", kind: "input", assets: [{ unit: "lovelace", quantity: "5" }] },
      { id: `tx:one->addr:${B}:output`, source: "tx:one", target: `addr:${B}`, kind: "output", assets: [{ unit: "lovelace", quantity: "4" }] },
      { id: "tx:one->protocol:fee:fee", source: "tx:one", target: "protocol:fee", kind: "fee", assets: [{ unit: "lovelace", quantity: "1" }] },
    ],
  };
}

function columnOf(result: ReturnType<typeof layoutTokenFlow>, id: string): number {
  const node = result.nodes.find((n) => n.id === id)!;
  return node.position.x / COLUMN_WIDTH;
}

describe("layoutTokenFlow", () => {
  test("single tx: inputs col 0, tx col 1, outputs col 2", () => {
    const result = layoutTokenFlow(singleTxFlow());
    expect(columnOf(result, `addr:${A}`)).toBe(0);
    expect(columnOf(result, "tx:one")).toBe(1);
    expect(columnOf(result, `addr:${B}`)).toBe(2);
  });

  test("protocol node sits below the value rows", () => {
    const result = layoutTokenFlow(singleTxFlow());
    const feeNode = result.nodes.find((n) => n.id === "protocol:fee")!;
    const maxValueY = Math.max(
      ...result.nodes
        .filter((n) => n.id !== "protocol:fee")
        .map((n) => n.position.y),
    );
    expect(feeNode.position.y).toBeGreaterThan(maxValueY);
  });

  test("deterministic: same input yields identical positions", () => {
    const a = layoutTokenFlow(singleTxFlow());
    const b = layoutTokenFlow(singleTxFlow());
    expect(a.nodes).toEqual(b.nodes);
  });

  test("two chained txs: consumer tx lands one layer to the right", () => {
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
    const merged = mergeTokenFlows([singleTxFlow(), txTwo]);
    const result = layoutTokenFlow(merged);

    expect(columnOf(result, "tx:one")).toBe(1);
    // B is produced by tx:one (col 2) and consumed by tx:two — the shared
    // join point sits between the two transactions.
    expect(columnOf(result, `addr:${B}`)).toBe(2);
    expect(columnOf(result, "tx:two")).toBe(3);
    expect(columnOf(result, `addr:${C}`)).toBe(4);
  });

  test("multiple protocol nodes never share a position", () => {
    const flow = singleTxFlow();
    flow.nodes.push({ id: "protocol:deposit", kind: "protocol", role: "deposit", label: "Protocol deposit" });
    flow.edges.push({
      id: "tx:one->protocol:deposit:deposit",
      source: "tx:one",
      target: "protocol:deposit",
      kind: "deposit",
      assets: [{ unit: "lovelace", quantity: "2" }],
    });
    const result = layoutTokenFlow(flow);
    const fee = result.nodes.find((n) => n.id === "protocol:fee")!;
    const deposit = result.nodes.find((n) => n.id === "protocol:deposit")!;
    expect(Math.abs(fee.position.x - deposit.position.x)).toBeGreaterThanOrEqual(150);
    expect(fee.position.y).toBe(deposit.position.y);
  });

  test("each outgoing protocol edge gets its own bottom port (registration: fee + deposit)", () => {
    // A DRep/stake registration pays a fee AND a deposit — two OUTGOING
    // edges. They must leave from two distinct connectors (no shared
    // fan-out point), ordered to match the pills: deposit pill sorts left
    // of the fee pill.
    const flow = singleTxFlow();
    flow.nodes.push({ id: "protocol:deposit", kind: "protocol", role: "deposit", label: "Protocol deposit" });
    flow.edges.push({
      id: "tx:one->protocol:deposit:deposit",
      source: "tx:one",
      target: "protocol:deposit",
      kind: "deposit",
      assets: [{ unit: "lovelace", quantity: "500000000" }],
    });
    const result = layoutTokenFlow(flow);

    const depositPill = result.nodes.find((n) => n.id === "protocol:deposit")!;
    const feePill = result.nodes.find((n) => n.id === "protocol:fee")!;
    expect(depositPill.position.x).toBeLessThan(feePill.position.x);

    const deposit = result.edges.find((e) => e.data!.edge.kind === "deposit")!;
    const fee = result.edges.find((e) => e.data!.edge.kind === "fee")!;
    expect(deposit.sourceHandle).toBe("proto-0"); // left port → left pill
    expect(fee.sourceHandle).toBe("proto-1"); // right port → right pill
    const tx = result.nodes.find((n) => n.id === "tx:one")!;
    expect(tx.data.protoPorts).toEqual([
      { id: "proto-0", type: "source" },
      { id: "proto-1", type: "source" },
    ]);
  });

  test("bottom ports follow pill order: refund-in renders left of fee-out", () => {
    // A deregistration: refund comes IN from the deposit pill (left), fee
    // goes OUT to the fee pill (right) — ports must order the same way or
    // the two vertical edges cross.
    const flow = singleTxFlow();
    flow.nodes.push({ id: "protocol:deposit", kind: "protocol", role: "deposit", label: "Protocol deposit" });
    flow.edges.push({
      id: "protocol:deposit->tx:one:deposit-refund",
      source: "protocol:deposit",
      target: "tx:one",
      kind: "deposit-refund",
      assets: [{ unit: "lovelace", quantity: "500" }],
    });
    const result = layoutTokenFlow(flow);

    const deposit = result.nodes.find((n) => n.id === "protocol:deposit")!;
    const fee = result.nodes.find((n) => n.id === "protocol:fee")!;
    expect(deposit.position.x).toBeLessThan(fee.position.x); // the premise
    const refund = result.edges.find((e) => e.data!.edge.kind === "deposit-refund")!;
    const feeEdge = result.edges.find((e) => e.data!.edge.kind === "fee")!;
    expect(refund.targetHandle).toBe("proto-0");
    expect(feeEdge.sourceHandle).toBe("proto-1");
    const tx = result.nodes.find((n) => n.id === "tx:one")!;
    expect(tx.data.protoPorts).toEqual([
      { id: "proto-0", type: "target" },
      { id: "proto-1", type: "source" },
    ]);
  });

  test("edges carrying assets are animated; empty ones are not", () => {
    const flow = singleTxFlow();
    flow.edges.push({
      id: "tx:one->addr:extra:output",
      source: "tx:one",
      target: `addr:${B}`,
      kind: "output",
      assets: [],
      note: "change",
    });
    const result = layoutTokenFlow(flow);
    expect(result.edges.find((e) => e.id === "tx:one->protocol:fee:fee")?.animated).toBe(true);
    expect(result.edges.find((e) => e.id === "tx:one->addr:extra:output")?.animated).toBe(false);
  });
});

/** A self+change tx: A funds tx:one, which pays B and change back to A. */
function selfChangeFlow(): TokenFlow {
  return {
    nodes: [
      { id: `addr:${A}`, kind: "address", address: A, partyType: "self" },
      { id: `addr:${B}`, kind: "address", address: B, partyType: "unknown" },
      { id: "tx:one", kind: "transaction", txHash: "one", status: "onchain", badges: [] },
    ],
    edges: [
      { id: `addr:${A}->tx:one:input`, source: `addr:${A}`, target: "tx:one", kind: "input", assets: [{ unit: "lovelace", quantity: "5" }] },
      { id: `tx:one->addr:${B}:output`, source: "tx:one", target: `addr:${B}`, kind: "output", assets: [{ unit: "lovelace", quantity: "2" }] },
      { id: `tx:one->addr:${A}:output`, source: "tx:one", target: `addr:${A}`, kind: "output", assets: [{ unit: "lovelace", quantity: "3" }] },
    ],
  };
}

describe("layoutTokenFlow — explorer-style instance splitting", () => {
  test("same-tx input+output address splits into @in and @out instances", () => {
    const result = layoutTokenFlow(selfChangeFlow());
    expect(result.nodes.find((n) => n.id === `addr:${A}`)).toBeUndefined();
    expect(columnOf(result, `addr:${A}@in`)).toBe(0);
    expect(columnOf(result, `addr:${A}@out`)).toBe(2);

    const inputEdge = result.edges.find((e) => e.data!.edge.kind === "input")!;
    expect(inputEdge.source).toBe(`addr:${A}@in`);
    const changeOutput = result.edges.find(
      (e) => e.id === `tx:one->addr:${A}:output`,
    )!;
    expect(changeOutput.target).toBe(`addr:${A}@out`);

    const outInstance = result.nodes.find((n) => n.id === `addr:${A}@out`)!;
    const inInstance = result.nodes.find((n) => n.id === `addr:${A}@in`)!;
    expect(outInstance.data.changeHint).toBe(true);
    expect(inInstance.data.changeHint).toBeUndefined();
  });

  test("no value edge ever flows backwards (chain + change)", () => {
    const txTwo: TokenFlow = {
      nodes: [
        { id: `addr:${B}`, kind: "address", address: B, partyType: "unknown" },
        { id: `addr:${C}`, kind: "address", address: C, partyType: "unknown" },
        { id: "tx:two", kind: "transaction", txHash: "two", status: "onchain", badges: [] },
      ],
      edges: [
        { id: `addr:${B}->tx:two:input`, source: `addr:${B}`, target: "tx:two", kind: "input", assets: [{ unit: "lovelace", quantity: "2" }] },
        { id: `tx:two->addr:${C}:output`, source: "tx:two", target: `addr:${C}`, kind: "output", assets: [{ unit: "lovelace", quantity: "1" }] },
      ],
    };
    const result = layoutTokenFlow(mergeTokenFlows([selfChangeFlow(), txTwo]));
    const nodeX = new Map(result.nodes.map((n) => [n.id, n.position.x]));
    for (const edge of result.edges) {
      const kind = edge.data!.edge.kind;
      if (kind !== "input" && kind !== "output" && kind !== "withdrawal") continue;
      expect(nodeX.get(edge.source)!).toBeLessThan(nodeX.get(edge.target)!);
    }
  });

  test("chained consumer sources from the @out join instance, no extra split", () => {
    const txTwo: TokenFlow = {
      nodes: [
        { id: `addr:${A}`, kind: "address", address: A, partyType: "self" },
        { id: "tx:two", kind: "transaction", txHash: "two", status: "onchain", badges: [] },
      ],
      edges: [
        { id: `addr:${A}->tx:two:input`, source: `addr:${A}`, target: "tx:two", kind: "input", assets: [{ unit: "lovelace", quantity: "3" }] },
      ],
    };
    const result = layoutTokenFlow(mergeTokenFlows([selfChangeFlow(), txTwo]));
    const aInstances = result.nodes.filter((n) => n.id.startsWith(`addr:${A}`));
    expect(aInstances.map((n) => n.id).sort()).toEqual([
      `addr:${A}@in`,
      `addr:${A}@out`,
    ]);
    const txTwoInput = result.edges.find(
      (e) => e.id === `addr:${A}->tx:two:input`,
    )!;
    expect(txTwoInput.source).toBe(`addr:${A}@out`);
  });

  test("handle assignment: value edges left-right, protocol edges bottom-top", () => {
    const flow = selfChangeFlow();
    flow.nodes.push(
      { id: "protocol:fee", kind: "protocol", role: "fee", label: "Network fee" },
      { id: "protocol:mint", kind: "protocol", role: "mint", label: "Mint / Burn" },
    );
    flow.edges.push(
      { id: "tx:one->protocol:fee:fee", source: "tx:one", target: "protocol:fee", kind: "fee", assets: [{ unit: "lovelace", quantity: "1" }] },
      { id: "protocol:mint->tx:one:mint", source: "protocol:mint", target: "tx:one", kind: "mint", assets: [{ unit: "policy1aa", quantity: "7" }] },
    );
    const result = layoutTokenFlow(flow);

    const input = result.edges.find((e) => e.data!.edge.kind === "input")!;
    expect(input.sourceHandle).toBe("out-0");
    expect(input.targetHandle).toBe("in-0");

    // Fee pill (left of mint pill) gets the tx's first bottom port; mint
    // arrives on the second. Pill side keeps the fixed top handles.
    const fee = result.edges.find((e) => e.data!.edge.kind === "fee")!;
    expect(fee.sourceHandle).toBe("proto-0");
    expect(fee.targetHandle).toBe(HANDLES.protocol.topIn);

    const mint = result.edges.find((e) => e.data!.edge.kind === "mint")!;
    expect(mint.sourceHandle).toBe(HANDLES.protocol.topOut);
    expect(mint.targetHandle).toBe("proto-1");

    // The tx advertises one bottom port per protocol edge, in pill order,
    // each with the direction its edge needs.
    const tx = result.nodes.find((n) => n.id === "tx:one")!;
    expect(tx.data.protoPorts).toEqual([
      { id: "proto-0", type: "source" },
      { id: "proto-1", type: "target" },
    ]);
    const feePill = result.nodes.find((n) => n.id === "protocol:fee")!;
    expect(feePill.data.usedProtoHandles).toEqual([HANDLES.protocol.topIn]);
    const mintPill = result.nodes.find((n) => n.id === "protocol:mint")!;
    expect(mintPill.data.usedProtoHandles).toEqual([HANDLES.protocol.topOut]);

    // Drift guard: every emitted handle id must be one the node components
    // render — a pill top-port constant, an indexed value port, or an
    // indexed tx bottom port.
    const protocolHandles = new Set<string>(
      Object.values(HANDLES).flatMap((group) => Object.values(group)),
    );
    const isKnown = (id: string) =>
      protocolHandles.has(id) || /^(in|out|proto)-\d+$/.test(id);
    for (const edge of result.edges) {
      expect(isKnown(edge.sourceHandle as string)).toBe(true);
      expect(isKnown(edge.targetHandle as string)).toBe(true);
    }
  });

  test("per-UTxO input edges each get their own connector port", () => {
    const flow = selfChangeFlow();
    // Replace the single input edge with two discriminated per-UTxO edges.
    flow.edges = flow.edges.filter((e) => e.kind !== "input");
    flow.edges.push(
      { id: `addr:${A}->tx:one:input:h#0`, source: `addr:${A}`, target: "tx:one", kind: "input", assets: [{ unit: "lovelace", quantity: "2" }], note: "h#0" },
      { id: `addr:${A}->tx:one:input:h#1`, source: `addr:${A}`, target: "tx:one", kind: "input", assets: [{ unit: "lovelace", quantity: "3" }], note: "h#1" },
    );
    const result = layoutTokenFlow(flow);

    // Both inputs survive the @in remap but fan out over distinct ports on
    // both endpoint cards (deterministic: ties within a side break by id).
    const inputs = result.edges
      .filter((e) => e.data!.edge.kind === "input")
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(inputs.map((e) => e.source)).toEqual([
      `addr:${A}@in`,
      `addr:${A}@in`,
    ]);
    expect(inputs.map((e) => e.sourceHandle)).toEqual(["out-0", "out-1"]);
    expect(inputs.map((e) => e.targetHandle)).toEqual(["in-0", "in-1"]);

    // The cards advertise matching port counts so the node components render
    // one connector dot per edge and grow vertically to fit the stack. Sides
    // with no edges advertise 0 — no stray unconnected dots.
    const inInstance = result.nodes.find((n) => n.id === `addr:${A}@in`)!;
    expect(inInstance.data.outPortCount).toBe(2);
    expect(inInstance.data.inPortCount).toBe(0);
    const tx = result.nodes.find((n) => n.id === "tx:one")!;
    expect(tx.data.inPortCount).toBe(2);
    expect(tx.data.outPortCount).toBe(2);

    // The tx's two outputs (to B and back to A@out) fan out on its right.
    const outputs = result.edges.filter((e) => e.data!.edge.kind === "output");
    expect(outputs.map((e) => e.sourceHandle).sort()).toEqual([
      "out-0",
      "out-1",
    ]);
  });

  test("connectablePorts keeps a min-1 dot per side for the builder's drag-to-connect", () => {
    const flow = selfChangeFlow();
    const trimmed = layoutTokenFlow(flow);
    const clamped = layoutTokenFlow(flow, { connectablePorts: true });

    // Pure recipient card: no out-edges → no right dot by default, but the
    // builder still gets one as the connection affordance.
    const recipient = (r: ReturnType<typeof layoutTokenFlow>) =>
      r.nodes.find((n) => n.id === `addr:${B}`)!;
    expect(recipient(trimmed).data.outPortCount).toBe(0);
    expect(recipient(clamped).data.outPortCount).toBe(1);
    expect(recipient(trimmed).data.inPortCount).toBe(1); // real edge on both

    // Input-side split instance: no in-edges → same story on its left.
    const inInstance = (r: ReturnType<typeof layoutTokenFlow>) =>
      r.nodes.find((n) => n.id === `addr:${A}@in`)!;
    expect(inInstance(trimmed).data.inPortCount).toBe(0);
    expect(inInstance(clamped).data.inPortCount).toBe(1);
  });

  test("protocol pill hangs beneath its transaction", () => {
    const result = layoutTokenFlow(singleTxFlow());
    const tx = result.nodes.find((n) => n.id === "tx:one")!;
    const fee = result.nodes.find((n) => n.id === "protocol:fee")!;
    expect(Math.abs(fee.position.x - tx.position.x)).toBeLessThan(COLUMN_WIDTH / 2);
    expect(fee.position.y).toBeGreaterThan(tx.position.y);
  });

  test("deterministic on a merged multi-tx flow (barycenter ordering)", () => {
    const txTwo: TokenFlow = {
      nodes: [
        { id: `addr:${B}`, kind: "address", address: B, partyType: "unknown" },
        { id: `addr:${C}`, kind: "address", address: C, partyType: "unknown" },
        { id: "tx:two", kind: "transaction", txHash: "two", status: "onchain", badges: [] },
      ],
      edges: [
        { id: `addr:${B}->tx:two:input`, source: `addr:${B}`, target: "tx:two", kind: "input", assets: [{ unit: "lovelace", quantity: "2" }] },
        { id: `tx:two->addr:${C}:output`, source: "tx:two", target: `addr:${C}`, kind: "output", assets: [{ unit: "lovelace", quantity: "1" }] },
      ],
    };
    const merged = mergeTokenFlows([selfChangeFlow(), txTwo]);
    const a = layoutTokenFlow(merged);
    const b = layoutTokenFlow(merged);
    expect(a.nodes).toEqual(b.nodes);
    expect(a.edges).toEqual(b.edges);
  });
});

describe("estimateHeight with titled vote badges", () => {
  const A = "addr_test1aaa";
  const B = "addr_test1bbb";

  function voteFlow(withTitles: boolean): TokenFlow {
    const badges = Array.from({ length: 4 }, (_, i) => ({
      kind: "vote" as const,
      label: "Vote: Yes",
      ...(withTitles ? { title: `Proposal number ${i}` } : {}),
    }));
    return {
      nodes: [
        { id: `addr:${A}`, kind: "address", address: A, partyType: "self" },
        { id: `addr:${B}`, kind: "address", address: B, partyType: "unknown" },
        { id: "txp:one", kind: "transaction", status: "pending", badges },
      ],
      edges: [
        { id: `addr:${A}->txp:one:input`, source: `addr:${A}`, target: "txp:one", kind: "input", assets: [] },
        { id: `txp:one->addr:${B}:output`, source: "txp:one", target: `addr:${B}`, kind: "output", assets: [] },
      ],
    };
  }

  test("titled badges make the tx card taller (addresses re-center lower)", () => {
    const plain = layoutTokenFlow(voteFlow(false));
    const titled = layoutTokenFlow(voteFlow(true));
    const yOf = (result: ReturnType<typeof layoutTokenFlow>, id: string) =>
      result.nodes.find((n) => n.id === id)!.position.y;
    // 4 titled rows (20px each) estimate taller than 2 wrap rows (24px each),
    // so the shorter address cards get centered further down.
    expect(yOf(titled, `addr:${A}`)).toBeGreaterThan(yOf(plain, `addr:${A}`));
  });

  test("longer wrapped titles estimate taller than short ones", () => {
    const short = voteFlowWithTitles(["Short title"]);
    const long = voteFlowWithTitles([
      "A very long governance proposal title that certainly wraps across multiple lines on the 240px transaction card",
    ]);
    const yOf = (result: ReturnType<typeof layoutTokenFlow>, id: string) =>
      result.nodes.find((n) => n.id === id)!.position.y;
    expect(yOf(layoutTokenFlow(long), `addr:${A}`)).toBeGreaterThan(
      yOf(layoutTokenFlow(short), `addr:${A}`),
    );
  });

  function voteFlowWithTitles(titles: string[]): TokenFlow {
    return {
      nodes: [
        { id: `addr:${A}`, kind: "address", address: A, partyType: "self" },
        { id: `addr:${B}`, kind: "address", address: B, partyType: "unknown" },
        {
          id: "txp:one",
          kind: "transaction",
          status: "pending",
          badges: titles.map((title) => ({
            kind: "vote" as const,
            label: "Vote: Yes",
            title,
          })),
        },
      ],
      edges: [
        { id: `addr:${A}->txp:one:input`, source: `addr:${A}`, target: "txp:one", kind: "input", assets: [] },
        { id: `txp:one->addr:${B}:output`, source: "txp:one", target: `addr:${B}`, kind: "output", assets: [] },
      ],
    };
  }
});
