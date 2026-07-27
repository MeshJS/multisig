import type { Edge, Node } from "@xyflow/react";

import type { FlowEdge, FlowNode, TokenFlow } from "@/types/token-flow";

/**
 * Deterministic columnar layout for the bipartite token-flow graph — no
 * external layout library. Each transaction gets a layer L (longest-path
 * depth over tx-to-tx reachability through shared address nodes); its input
 * addresses sit in column 2L, the tx in column 2L+1, outputs in 2L+2.
 * Protocol nodes (fee/deposit/mint) sit in a row beneath the transactions
 * they touch. Scales from one tx to the multi-tx chains of the future
 * transaction builder.
 */

// Wide enough that edge-label chips (asset amounts) between two columns
// don't collide with the nodes on either side.
export const COLUMN_WIDTH = 380;
const VERTICAL_GAP = 28;
const PROTOCOL_ROW_GAP = 70;
const PROTOCOL_SPACING = 190;

/** Estimated render height per node kind; tx cards grow with their badges. */
function estimateHeight(node: FlowNode): number {
  if (node.kind === "transaction") {
    const badgeRows = Math.ceil(node.badges.length / 2);
    return 84 + badgeRows * 24;
  }
  if (node.kind === "protocol") return 36;
  return 68;
}

export type TokenFlowNodeData = { node: FlowNode; [key: string]: unknown };
export type TokenFlowEdgeData = { edge: FlowEdge; [key: string]: unknown };

export function layoutTokenFlow(flow: TokenFlow): {
  nodes: Node<TokenFlowNodeData>[];
  edges: Edge<TokenFlowEdgeData>[];
} {
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const txIds = flow.nodes
    .filter((node) => node.kind === "transaction")
    .map((node) => node.id);

  // tx A precedes tx B when A outputs to an address B spends from.
  const producersByAddress = new Map<string, string[]>();
  const consumersByAddress = new Map<string, string[]>();
  for (const edge of flow.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (source?.kind === "transaction" && target?.kind === "address") {
      producersByAddress.set(edge.target, [
        ...(producersByAddress.get(edge.target) ?? []),
        edge.source,
      ]);
    }
    if (source?.kind === "address" && target?.kind === "transaction") {
      consumersByAddress.set(edge.source, [
        ...(consumersByAddress.get(edge.source) ?? []),
        edge.target,
      ]);
    }
  }
  const successors = new Map<string, Set<string>>(
    txIds.map((id) => [id, new Set<string>()]),
  );
  for (const [address, producers] of producersByAddress) {
    for (const producer of producers) {
      for (const consumer of consumersByAddress.get(address) ?? []) {
        if (consumer !== producer) successors.get(producer)?.add(consumer);
      }
    }
  }

  // Longest-path layering; graphs are tiny, so simple relaxation is fine.
  const layer = new Map<string, number>(txIds.map((id) => [id, 0]));
  for (let i = 0; i < txIds.length; i++) {
    let changed = false;
    for (const [tx, next] of successors) {
      for (const successor of next) {
        if (layer.get(successor)! < layer.get(tx)! + 1) {
          layer.set(successor, layer.get(tx)! + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Column assignment.
  const column = new Map<string, number>();
  for (const tx of txIds) column.set(tx, 2 * layer.get(tx)! + 1);
  for (const node of flow.nodes) {
    if (node.kind !== "address") continue;
    const candidates: number[] = [];
    for (const consumer of consumersByAddress.get(node.id) ?? []) {
      candidates.push(2 * layer.get(consumer)!);
    }
    for (const producer of producersByAddress.get(node.id) ?? []) {
      candidates.push(2 * layer.get(producer)! + 2);
    }
    // A chain address (produced by tx L, consumed by tx L+1) lands between
    // them because 2L+2 === 2(L+1); Math.max keeps it after its producer.
    column.set(node.id, candidates.length > 0 ? Math.max(...candidates) : 0);
  }

  // Stack nodes per column (sorted by id for determinism), using estimated
  // heights so tall transaction cards never overlap their neighbours;
  // shorter columns are centered against the tallest one.
  const byColumn = new Map<number, FlowNode[]>();
  for (const node of flow.nodes) {
    if (node.kind === "protocol") continue;
    const col = column.get(node.id) ?? 0;
    byColumn.set(col, [...(byColumn.get(col) ?? []), node]);
  }
  const columnHeight = (nodes: FlowNode[]): number =>
    nodes.reduce((sum, node) => sum + estimateHeight(node), 0) +
    Math.max(0, nodes.length - 1) * VERTICAL_GAP;
  const maxHeight = Math.max(
    estimateHeight({ id: "", kind: "protocol", role: "fee", label: "" }),
    ...[...byColumn.values()].map(columnHeight),
  );

  const positioned: Node<TokenFlowNodeData>[] = [];
  for (const [col, columnNodes] of byColumn) {
    const sorted = [...columnNodes].sort((a, b) => (a.id < b.id ? -1 : 1));
    let y = (maxHeight - columnHeight(sorted)) / 2;
    for (const node of sorted) {
      positioned.push({
        id: node.id,
        type: node.kind,
        position: { x: col * COLUMN_WIDTH, y },
        data: { node },
      });
      y += estimateHeight(node) + VERTICAL_GAP;
    }
  }

  // Protocol nodes: one row beneath everything, starting under the average
  // column of the transactions each touches, spread out so they never
  // overlap each other.
  const protocolNodes = flow.nodes.filter((node) => node.kind === "protocol");
  const bottomY = maxHeight + PROTOCOL_ROW_GAP;
  const sortedProtocol = [...protocolNodes].sort((a, b) =>
    a.id < b.id ? -1 : 1,
  );
  sortedProtocol.forEach((node, i) => {
    const connectedTxColumns = flow.edges
      .filter((edge) => edge.source === node.id || edge.target === node.id)
      .map((edge) => (edge.source === node.id ? edge.target : edge.source))
      .map((txId) => column.get(txId) ?? 1);
    const averageColumn =
      connectedTxColumns.length > 0
        ? connectedTxColumns.reduce((a, b) => a + b, 0) /
          connectedTxColumns.length
        : 1;
    positioned.push({
      id: node.id,
      type: node.kind,
      position: {
        x: averageColumn * COLUMN_WIDTH + i * PROTOCOL_SPACING,
        y: bottomY,
      },
      data: { node },
    });
  });

  const edges: Edge<TokenFlowEdgeData>[] = flow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "asset",
    animated: edge.assets.length > 0,
    data: { edge },
  }));

  return { nodes: positioned, edges };
}
