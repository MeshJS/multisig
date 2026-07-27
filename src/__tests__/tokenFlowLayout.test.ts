import {
  COLUMN_WIDTH,
  layoutTokenFlow,
} from "@/components/common/token-flow/layout";
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
