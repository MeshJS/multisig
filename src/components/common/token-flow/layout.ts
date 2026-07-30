import type { Edge, Node } from "@xyflow/react";

import type { FlowEdge, FlowNode, TokenFlow } from "@/types/token-flow";
import { HANDLES, portStackHeight, valuePortIn, valuePortOut } from "./handles";

/**
 * Deterministic columnar layout for the bipartite token-flow graph — no
 * external layout library. Each transaction gets a layer L (longest-path
 * depth over tx-to-tx reachability through shared address nodes); its input
 * addresses sit in column 2L, the tx in column 2L+1, outputs in 2L+2.
 *
 * Explorer-style UTxO view: an address that is both input and output of the
 * SAME transaction is rendered twice — an `@in` instance in the input column
 * and an `@out` instance in the output column (with a "change" hint) — so
 * every value edge flows strictly left→right and never crosses back. An
 * address produced by one tx and consumed by a LATER tx stays a single join
 * node between them.
 *
 * Protocol nodes (fee/deposit/mint) hang directly beneath the transactions
 * they touch and connect through dedicated bottom/top ports, so their edges
 * are vertical drops that never cross the horizontal value flow.
 */

// Wide enough that edge-label chips (asset amounts) between two columns
// don't collide with the nodes on either side.
export const COLUMN_WIDTH = 380;
const VERTICAL_GAP = 28;
const PROTOCOL_ROW_GAP = 90;
const PROTOCOL_SPACING = 190;
// Offset from a tx column's x to the tx card's bottom-center, where the
// protocol ports sit (tx card is 240px wide).
const TX_BOTTOM_CENTER_OFFSET = 60;

/**
 * Estimated render height per node kind; tx cards grow with their badges,
 * and any card grows further when its per-edge connector stack needs more
 * room than its content (`ports` = max edges on either side).
 */
function estimateHeight(node: FlowNode, ports = 1): number {
  if (node.kind === "protocol") return 36;
  let content = 68;
  if (node.kind === "transaction") {
    const badgeRows = Math.ceil(node.badges.length / 2);
    const detailRows = node.blockHeight !== undefined ? 1 : 0;
    content = 84 + detailRows * 16 + badgeRows * 24;
  }
  return Math.max(content, portStackHeight(ports));
}

export type TokenFlowNodeData = {
  node: FlowNode;
  /** Set on split address instances: which side of its tx this copy sits on. */
  instanceRole?: "in" | "out";
  /** True on the output-side instance when the same tx also spends from it. */
  changeHint?: boolean;
  /** Number of per-edge connector dots to render on each side (min 1). */
  inPortCount?: number;
  outPortCount?: number;
  /** Which protocol ports carry an edge; unused ones aren't rendered. */
  usedProtoHandles?: string[];
  [key: string]: unknown;
};
export type TokenFlowEdgeData = {
  edge: FlowEdge;
  [key: string]: unknown;
};

type AddressInstance = {
  id: string;
  node: FlowNode;
  column: number;
  role?: "in" | "out";
  changeHint?: boolean;
};

const PROTOCOL_EDGE_HANDLES: Partial<
  Record<FlowEdge["kind"], { sourceHandle: string; targetHandle: string }>
> = {
  fee: {
    sourceHandle: HANDLES.transaction.protoOut,
    targetHandle: HANDLES.protocol.topIn,
  },
  deposit: {
    sourceHandle: HANDLES.transaction.protoOut,
    targetHandle: HANDLES.protocol.topIn,
  },
  burn: {
    sourceHandle: HANDLES.transaction.protoOut,
    targetHandle: HANDLES.protocol.topIn,
  },
  "deposit-refund": {
    sourceHandle: HANDLES.protocol.topOut,
    targetHandle: HANDLES.transaction.protoIn,
  },
  mint: {
    sourceHandle: HANDLES.protocol.topOut,
    targetHandle: HANDLES.transaction.protoIn,
  },
};

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
  const txColumn = (txId: string): number => 2 * (layer.get(txId) ?? 0) + 1;

  // --- Address instance planning (the explorer-style split) ---------------
  // For each address, decide whether it renders as one node or as an @in
  // plus @out pair, and which instance each of its edges attaches to.
  const column = new Map<string, number>(); // instance id (or tx id) -> column
  for (const tx of txIds) column.set(tx, txColumn(tx));

  const instances: AddressInstance[] = [];
  // (address, consuming tx) -> instance id the input edge sources from
  const consumerInstance = new Map<string, string>();
  // address -> instance id its output edges target
  const outputInstance = new Map<string, string>();

  for (const node of flow.nodes) {
    if (node.kind !== "address") continue;
    const producers = producersByAddress.get(node.id) ?? [];
    const consumers = [...new Set(consumersByAddress.get(node.id) ?? [])];

    const outCol =
      producers.length > 0
        ? Math.max(...producers.map((p) => txColumn(p) + 1))
        : undefined;

    // A consumer can reuse the produced (@out) instance only when that
    // instance sits strictly left of the consuming tx (forward flow);
    // otherwise the address needs an input-side instance.
    const inConsumers = consumers.filter(
      (tx) => outCol === undefined || outCol >= txColumn(tx),
    );
    const outConsumers = consumers.filter(
      (tx) => outCol !== undefined && outCol < txColumn(tx),
    );
    const inCol =
      inConsumers.length > 0
        ? Math.min(...inConsumers.map((tx) => txColumn(tx) - 1))
        : undefined;

    const split = inCol !== undefined && outCol !== undefined;
    if (split) {
      const inId = `${node.id}@in`;
      const outId = `${node.id}@out`;
      instances.push({ id: inId, node, column: inCol, role: "in" });
      instances.push({
        id: outId,
        node,
        column: outCol,
        role: "out",
        // "change" when the same tx both spends from and pays this address
        changeHint: producers.some((p) => inConsumers.includes(p)),
      });
      for (const tx of inConsumers) consumerInstance.set(`${node.id}|${tx}`, inId);
      for (const tx of outConsumers) consumerInstance.set(`${node.id}|${tx}`, outId);
      outputInstance.set(node.id, outId);
      column.set(inId, inCol);
      column.set(outId, outCol);
    } else {
      const col = inCol ?? outCol ?? 0;
      instances.push({ id: node.id, node, column: col });
      for (const tx of consumers) consumerInstance.set(`${node.id}|${tx}`, node.id);
      outputInstance.set(node.id, node.id);
      column.set(node.id, col);
    }
  }

  // --- Remapped React Flow edges ------------------------------------------
  const edges: Edge<TokenFlowEdgeData>[] = flow.edges.map((edge) => {
    let source = edge.source;
    let target = edge.target;
    // Value edges get real per-edge ports assigned after positioning (the
    // port order depends on where the counterpart cards end up).
    let handles: { sourceHandle: string; targetHandle: string } = {
      sourceHandle: valuePortOut(0),
      targetHandle: valuePortIn(0),
    };

    const protocolHandles = PROTOCOL_EDGE_HANDLES[edge.kind];
    if (protocolHandles) {
      handles = protocolHandles;
    } else if (edge.kind === "input" || edge.kind === "withdrawal") {
      source = consumerInstance.get(`${edge.source}|${edge.target}`) ?? edge.source;
    } else if (edge.kind === "output") {
      target = outputInstance.get(edge.target) ?? edge.target;
    }

    return {
      id: edge.id,
      source,
      target,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      type: "asset",
      animated: edge.assets.length > 0,
      data: { edge },
    };
  });

  // Per-edge connector planning: every value edge occupies its own port on
  // both endpoint cards (per-UTxO inputs each get their own dot instead of
  // converging on one shared handle). Counting ports up front lets the
  // stacking below grow cards vertically to fit their connector stacks.
  const valueEdges = edges.filter(
    (edge) => !PROTOCOL_EDGE_HANDLES[edge.data!.edge.kind],
  );
  const inPorts = new Map<string, number>();
  const outPorts = new Map<string, number>();
  for (const edge of valueEdges) {
    outPorts.set(edge.source, (outPorts.get(edge.source) ?? 0) + 1);
    inPorts.set(edge.target, (inPorts.get(edge.target) ?? 0) + 1);
  }
  const inPortCount = (id: string) => Math.max(1, inPorts.get(id) ?? 0);
  const outPortCount = (id: string) => Math.max(1, outPorts.get(id) ?? 0);
  const portCount = (id: string) =>
    Math.max(inPortCount(id), outPortCount(id));

  // Protocol ports (tx bottom, pill top) render only when an edge actually
  // uses them — otherwise cards show stray unconnected dots.
  const usedProtoHandles = new Map<string, string[]>();
  const markProto = (nodeId: string, handle: string) => {
    const list = usedProtoHandles.get(nodeId) ?? [];
    if (!list.includes(handle)) usedProtoHandles.set(nodeId, [...list, handle]);
  };
  for (const edge of flow.edges) {
    const protoHandles = PROTOCOL_EDGE_HANDLES[edge.kind];
    if (!protoHandles) continue;
    markProto(edge.source, protoHandles.sourceHandle);
    markProto(edge.target, protoHandles.targetHandle);
  }

  // --- Stack instances per column ----------------------------------------
  // Heights are estimated per node kind so tall transaction cards never
  // overlap their neighbours; shorter columns center against the tallest.
  // Row order within a column follows a one-pass barycenter sweep (mean
  // y-center of already-placed neighbours in lower columns) so edges in
  // merged multi-tx flows stay as parallel as possible; ties break by id.
  type ColumnEntry = {
    id: string;
    node: FlowNode;
    role?: "in" | "out";
    changeHint?: boolean;
  };
  const byColumn = new Map<number, ColumnEntry[]>();
  const pushEntry = (col: number, entry: ColumnEntry) =>
    byColumn.set(col, [...(byColumn.get(col) ?? []), entry]);
  for (const instance of instances) {
    pushEntry(instance.column, {
      id: instance.id,
      node: instance.node,
      role: instance.role,
      changeHint: instance.changeHint,
    });
  }
  for (const tx of txIds) {
    pushEntry(txColumn(tx), { id: tx, node: nodesById.get(tx)! });
  }

  const columnHeight = (entries: ColumnEntry[]): number =>
    entries.reduce(
      (sum, entry) => sum + estimateHeight(entry.node, portCount(entry.id)),
      0,
    ) +
    Math.max(0, entries.length - 1) * VERTICAL_GAP;
  const maxHeight = Math.max(
    36,
    ...[...byColumn.values()].map(columnHeight),
  );

  // Neighbours in lower columns, per instance id (from the remapped edges).
  const lowerNeighbors = new Map<string, string[]>();
  for (const edge of edges) {
    if (PROTOCOL_EDGE_HANDLES[edge.data!.edge.kind]) continue;
    const sourceCol = column.get(edge.source);
    const targetCol = column.get(edge.target);
    if (sourceCol === undefined || targetCol === undefined) continue;
    const [lower, higher] =
      sourceCol < targetCol ? [edge.source, edge.target] : [edge.target, edge.source];
    lowerNeighbors.set(higher, [...(lowerNeighbors.get(higher) ?? []), lower]);
  }

  const positioned: Node<TokenFlowNodeData>[] = [];
  const centerY = new Map<string, number>();
  const sortedColumns = [...byColumn.keys()].sort((a, b) => a - b);
  for (const col of sortedColumns) {
    const entries = byColumn.get(col)!;
    const rank = (entry: ColumnEntry): number => {
      const neighbors = (lowerNeighbors.get(entry.id) ?? [])
        .map((id) => centerY.get(id))
        .filter((y): y is number => y !== undefined);
      return neighbors.length > 0
        ? neighbors.reduce((a, b) => a + b, 0) / neighbors.length
        : Number.POSITIVE_INFINITY; // unconnected entries sink to the bottom
    };
    const sorted = [...entries].sort((a, b) => {
      const diff = rank(a) - rank(b);
      if (diff !== 0 && !Number.isNaN(diff)) return diff;
      return a.id < b.id ? -1 : 1;
    });

    let y = (maxHeight - columnHeight(sorted)) / 2;
    for (const entry of sorted) {
      const height = estimateHeight(entry.node, portCount(entry.id));
      positioned.push({
        id: entry.id,
        type: entry.node.kind,
        position: { x: col * COLUMN_WIDTH, y },
        data: {
          node: entry.node,
          inPortCount: inPortCount(entry.id),
          outPortCount: outPortCount(entry.id),
          ...(usedProtoHandles.has(entry.id)
            ? { usedProtoHandles: usedProtoHandles.get(entry.id) }
            : {}),
          ...(entry.role ? { instanceRole: entry.role } : {}),
          ...(entry.changeHint ? { changeHint: true } : {}),
        },
      });
      centerY.set(entry.id, y + height / 2);
      y += height + VERTICAL_GAP;
    }
  }

  // --- Per-edge port assignment -------------------------------------------
  // Each card's ports are ordered by the counterpart card's vertical center
  // (ties broken by edge id) so the connector fans never cross themselves,
  // then every value edge is pinned to its own indexed handle on both ends.
  const bySide = (counterpartOf: (edge: Edge<TokenFlowEdgeData>) => string) => {
    return (a: Edge<TokenFlowEdgeData>, b: Edge<TokenFlowEdgeData>) => {
      const diff =
        (centerY.get(counterpartOf(a)) ?? 0) -
        (centerY.get(counterpartOf(b)) ?? 0);
      if (diff !== 0) return diff;
      return a.id < b.id ? -1 : 1;
    };
  };
  const outEdgesByNode = new Map<string, Edge<TokenFlowEdgeData>[]>();
  const inEdgesByNode = new Map<string, Edge<TokenFlowEdgeData>[]>();
  for (const edge of valueEdges) {
    outEdgesByNode.set(edge.source, [
      ...(outEdgesByNode.get(edge.source) ?? []),
      edge,
    ]);
    inEdgesByNode.set(edge.target, [
      ...(inEdgesByNode.get(edge.target) ?? []),
      edge,
    ]);
  }
  for (const group of outEdgesByNode.values()) {
    [...group].sort(bySide((edge) => edge.target)).forEach((edge, index) => {
      edge.sourceHandle = valuePortOut(index);
    });
  }
  for (const group of inEdgesByNode.values()) {
    [...group].sort(bySide((edge) => edge.source)).forEach((edge, index) => {
      edge.targetHandle = valuePortIn(index);
    });
  }

  // --- Protocol nodes: hang beneath the transactions they touch ----------
  const protocolNodes = flow.nodes.filter((node) => node.kind === "protocol");
  const bottomY = maxHeight + PROTOCOL_ROW_GAP;
  const sortedProtocol = [...protocolNodes].sort((a, b) =>
    a.id < b.id ? -1 : 1,
  );
  const anchors = sortedProtocol.map((node) => {
    const connectedTxColumns = flow.edges
      .filter((edge) => edge.source === node.id || edge.target === node.id)
      .map((edge) => (edge.source === node.id ? edge.target : edge.source))
      .map((txId) => column.get(txId) ?? 1);
    const averageColumn =
      connectedTxColumns.length > 0
        ? connectedTxColumns.reduce((a, b) => a + b, 0) /
          connectedTxColumns.length
        : 1;
    return averageColumn * COLUMN_WIDTH + TX_BOTTOM_CENTER_OFFSET;
  });
  // Spread pills sharing (roughly) the same anchor so they never overlap.
  const anchorGroups = new Map<number, number[]>(); // rounded anchor -> indices
  anchors.forEach((anchor, i) => {
    const key = Math.round(anchor / 10) * 10;
    anchorGroups.set(key, [...(anchorGroups.get(key) ?? []), i]);
  });
  sortedProtocol.forEach((node, i) => {
    const group = [...anchorGroups.values()].find((g) => g.includes(i))!;
    const posInGroup = group.indexOf(i);
    const x = anchors[i]! + (posInGroup - (group.length - 1) / 2) * PROTOCOL_SPACING;
    positioned.push({
      id: node.id,
      type: node.kind,
      position: { x, y: bottomY },
      data: { node, usedProtoHandles: usedProtoHandles.get(node.id) ?? [] },
    });
  });

  return { nodes: positioned, edges };
}
