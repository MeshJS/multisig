import type { Edge, Node } from "@xyflow/react";

import type { FlowEdge, FlowNode, TokenFlow } from "@/types/token-flow";
import {
  HANDLES,
  portStackHeight,
  protoPort,
  valuePortIn,
  valuePortOut,
} from "./handles";

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
// Timeline (txOrder) mode uses wider columns: boundary columns split into
// three lanes around the event divider line, and the extra width is what
// buys each lane card clearance from the line and from the tx cards beside
// it.
export const TIMELINE_COLUMN_WIDTH = 460;
// Must match the address card's Tailwind w-[220px].
export const ADDRESS_CARD_WIDTH = 220;
// Timeline lanes: inside a boundary column (between two timeline events)
// producer-only cards shift left by this and consumer-only cards right,
// while joins — and the wallet's own (partyType "self") cards regardless of
// role, since the wallet's UTxOs persist across boundaries — stay centered
// ON the divider line at the column's unshifted card centerline. 150 = half
// the address card + 40px of clearance between a lane card's edge and the
// line.
export const TIMELINE_LANE_OFFSET = 150;
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
    // Titled badges (votes with a resolved proposal name) render the full
    // wrapped title plus a vote pill below it; untitled badges wrap ~2 pills
    // per row. Title wrapping estimate: ~45 chars per line on the 240px card
    // at 9px, ~12px per line, plus ~22px for the pill row.
    const titledBadges = node.badges.filter((badge) => badge.title);
    const titledHeight = titledBadges.reduce(
      (sum, badge) =>
        sum + Math.ceil(badge.title!.length / 45) * 12 + 22,
      0,
    );
    const badgeRows = Math.ceil(
      (node.badges.length - titledBadges.length) / 2,
    );
    const detailRows = node.blockHeight !== undefined ? 1 : 0;
    content = 84 + detailRows * 16 + badgeRows * 24 + titledHeight;
  }
  return Math.max(content, portStackHeight(ports));
}

export type TokenFlowNodeData = {
  node: FlowNode;
  /** Set on split address instances: which side of its tx this copy sits on. */
  instanceRole?: "in" | "out";
  /** True on the output-side instance when the same tx also spends from it. */
  changeHint?: boolean;
  /** Per-edge connector dots to render on each side (0 when nothing
   *  attaches, unless LayoutOptions.connectablePorts keeps a min of 1). */
  inPortCount?: number;
  outPortCount?: number;
  /** Pill top ports that carry an edge; unused ones aren't rendered. */
  usedProtoHandles?: string[];
  /** Tx bottom ports, one per protocol edge, in left→right (pill x) order. */
  protoPorts?: { id: string; type: "source" | "target" }[];
  /** Appended to the node testid; see LayoutOptions.testIdSuffix. */
  testIdSuffix?: string;
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
  /** Timeline lane shift within a boundary column; see TIMELINE_LANE_OFFSET. */
  xOffset?: number;
};

/**
 * Protocol edge classification: the fixed pill-side handle plus which end
 * the transaction card is on. The tx side gets a per-edge `proto-N` port
 * assigned after positioning (in pill x-order, so edges never cross).
 */
const PROTOCOL_EDGE_SPEC: Partial<
  Record<FlowEdge["kind"], { pillHandle: string; txIsSource: boolean }>
> = {
  fee: { pillHandle: HANDLES.protocol.topIn, txIsSource: true },
  deposit: { pillHandle: HANDLES.protocol.topIn, txIsSource: true },
  burn: { pillHandle: HANDLES.protocol.topIn, txIsSource: true },
  "deposit-refund": { pillHandle: HANDLES.protocol.topOut, txIsSource: false },
  mint: { pillHandle: HANDLES.protocol.topOut, txIsSource: false },
};

export type LayoutOptions = {
  /**
   * Timeline mode: tx node ids ordered oldest → newest. Each listed tx gets
   * layer = its index in this list (strictly one tx per layer), replacing the
   * dependency-based longest-path layering. Ids absent from the flow keep
   * their index — the gap preserves loaded-tx positions while data for other
   * txs streams in. Txs present in the flow but not listed fall back to
   * layer 0. Address instancing also switches to per-column (`@c<col>`)
   * so every value edge stays one column long, and protocol pills render
   * once per touching tx (`protocol:fee@c<col>`) — globally shared
   * instances would fan full-width edges across the whole timeline.
   */
  txOrder?: string[];
  /**
   * Appended to node testids so two canvases rendering the same tx (e.g. the
   * timeline plus an expanded per-row viz) don't collide.
   */
  testIdSuffix?: string;
  /**
   * Keep at least one connector dot per card side even when no value edge
   * attaches there. The builder canvas needs this: drag-to-connect requires
   * an existing in-0/out-0 Handle as the gesture's source or drop target.
   * Viewer canvases omit it so empty sides render no dots.
   */
  connectablePorts?: boolean;
};

export function layoutTokenFlow(
  flow: TokenFlow,
  opts?: LayoutOptions,
): {
  nodes: Node<TokenFlowNodeData>[];
  edges: Edge<TokenFlowEdgeData>[];
  /**
   * Layer per tx node id, as laid out (dependency- or txOrder-based). In
   * txOrder mode this covers every listed id — including ones with no nodes
   * yet — so viewport-visibility math can address unloaded columns.
   */
  txLayer: Map<string, number>;
  /**
   * Timeline event boundaries: one per pair of consecutive loaded txOrder
   * txs, at the boundary column's unshifted card centerline. `index` is the
   * left tx's txOrder index (stable while gaps fill in). Empty in default
   * mode.
   */
  dividers: { index: number; x: number }[];
  /** Vertical extent of the laid-out content, protocol row included. */
  bounds: { minY: number; maxY: number };
} {
  // Timeline mode spreads columns wider so boundary-lane cards keep
  // clearance around the divider lines.
  const colWidth = opts?.txOrder ? TIMELINE_COLUMN_WIDTH : COLUMN_WIDTH;
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

  const layer = new Map<string, number>(txIds.map((id) => [id, 0]));
  if (opts?.txOrder) {
    // Explicit chronological layering for EVERY listed id, loaded or not.
    // Unloaded ids position no nodes (their columns stay empty gaps), but
    // they must be in txLayer so the timeline's viewport controller can
    // report their columns as visible and demand their detail — keying off
    // loaded nodes only deadlocks hash-only callers at the seeded batch.
    opts.txOrder.forEach((id, index) => layer.set(id, index));
  } else {
    // Longest-path layering; graphs are tiny, so simple relaxation is fine.
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
  }
  const txColumn = (txId: string): number => 2 * (layer.get(txId) ?? 0) + 1;

  // --- Address instance planning (the explorer-style split) ---------------
  // For each address, decide whether it renders as one node or as several
  // per-column instances, and which instance each of its edges attaches to.
  const column = new Map<string, number>(); // instance id (or tx id) -> column
  for (const tx of txIds) column.set(tx, txColumn(tx));

  const instances: AddressInstance[] = [];
  // (address, consuming tx) -> instance id the input edge sources from
  const consumerInstance = new Map<string, string>();
  // (address, producing tx) -> instance id its output edge targets
  const producerInstance = new Map<string, string>();

  for (const node of flow.nodes) {
    if (node.kind !== "address") continue;
    const producers = producersByAddress.get(node.id) ?? [];
    const consumers = [...new Set(consumersByAddress.get(node.id) ?? [])];

    if (opts?.txOrder) {
      // Timeline mode: one instance per column, local to the txs touching
      // it. With every tx in its own layer, a globally shared instance
      // would sit at one end of a long timeline and fan full-width edges
      // to every tx it serves (the multisig's own address touches nearly
      // all of them). Local instances keep every value edge exactly one
      // column long; a tx's output consumed by the NEXT tx still lands
      // both roles on the same column and stays a single join node.
      const byCol = new Map<number, { producers: string[]; consumers: string[] }>();
      const at = (col: number) => {
        if (!byCol.has(col)) byCol.set(col, { producers: [], consumers: [] });
        return byCol.get(col)!;
      };
      for (const p of producers) at(txColumn(p) + 1).producers.push(p);
      for (const c of consumers) at(txColumn(c) - 1).consumers.push(c);
      if (byCol.size === 0) at(0);

      const single = byCol.size === 1;
      // Boundary columns lie strictly between the first tx's input column
      // and the last tx's output column. Only they get lane offsets; the
      // range comes from the FULL txOrder list (not loaded-neighbour
      // presence) so positions never shift as tx detail streams in.
      const laneMaxCol = 2 * (opts.txOrder.length - 1);
      for (const [col, group] of byCol) {
        // The wallet's own cards never lane-shift: its UTxOs persist across
        // event boundaries, so self rides the divider line whether it only
        // received (change held) or only sends (spending older UTxOs) —
        // only external parties settle left or enter right.
        const boundary =
          col >= 2 && col <= laneMaxCol && node.partyType !== "self";
        const hasBoth =
          group.producers.length > 0 && group.consumers.length > 0;

        // Only the wallet itself may sit ON the divider line. An external
        // address that both receives from the left event and sends into the
        // right one splits into two lane cards: a received (@out) card left
        // of the line and a sending (@in) card right of it.
        if (node.partyType !== "self" && hasBoth) {
          const outId = `${node.id}@c${col}@out`;
          const inId = `${node.id}@c${col}@in`;
          instances.push({
            id: outId,
            node,
            column: col,
            role: "out",
            changeHint: group.producers.some((p) => consumers.includes(p)),
            xOffset: boundary ? -TIMELINE_LANE_OFFSET : 0,
          });
          instances.push({
            id: inId,
            node,
            column: col,
            role: "in",
            xOffset: boundary ? TIMELINE_LANE_OFFSET : 0,
          });
          for (const c of group.consumers)
            consumerInstance.set(`${node.id}|${c}`, inId);
          for (const p of group.producers)
            producerInstance.set(`${node.id}|${p}`, outId);
          column.set(outId, col);
          column.set(inId, col);
          continue;
        }

        const id = single ? node.id : `${node.id}@c${col}`;
        const producerOnly =
          group.producers.length > 0 && group.consumers.length === 0;
        const consumerOnly =
          group.consumers.length > 0 && group.producers.length === 0;
        instances.push({
          id,
          node,
          column: col,
          role:
            single || hasBoth
              ? undefined
              : group.producers.length > 0
                ? "out"
                : "in",
          // "change" when a tx paying this instance also spends from the
          // same address (its own input instance sits two columns left).
          changeHint: group.producers.some((p) => consumers.includes(p)),
          xOffset: !boundary
            ? 0
            : producerOnly
              ? -TIMELINE_LANE_OFFSET
              : consumerOnly
                ? TIMELINE_LANE_OFFSET
                : 0,
        });
        for (const c of group.consumers) consumerInstance.set(`${node.id}|${c}`, id);
        for (const p of group.producers) producerInstance.set(`${node.id}|${p}`, id);
        column.set(id, col);
      }
      continue;
    }

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
      for (const p of producers) producerInstance.set(`${node.id}|${p}`, outId);
      column.set(inId, inCol);
      column.set(outId, outCol);
    } else {
      const col = inCol ?? outCol ?? 0;
      instances.push({ id: node.id, node, column: col });
      for (const tx of consumers) consumerInstance.set(`${node.id}|${tx}`, node.id);
      for (const p of producers) producerInstance.set(`${node.id}|${p}`, node.id);
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

    const protocolSpec = PROTOCOL_EDGE_SPEC[edge.kind];
    if (protocolSpec) {
      // Pill side is fixed; the tx side is a placeholder overwritten by the
      // per-edge port assignment after positioning (pill x-order).
      handles = protocolSpec.txIsSource
        ? { sourceHandle: protoPort(0), targetHandle: protocolSpec.pillHandle }
        : { sourceHandle: protocolSpec.pillHandle, targetHandle: protoPort(0) };
      // Timeline mode: protocol edges attach to the per-tx pill instance
      // (see the protocol placement section below).
      if (opts?.txOrder) {
        const sourceIsProtocol = nodesById.get(edge.source)?.kind === "protocol";
        const txId = sourceIsProtocol ? edge.target : edge.source;
        const instanceId = `${sourceIsProtocol ? edge.source : edge.target}@c${
          column.get(txId) ?? 1
        }`;
        if (sourceIsProtocol) source = instanceId;
        else target = instanceId;
      }
    } else if (edge.kind === "input" || edge.kind === "withdrawal") {
      source = consumerInstance.get(`${edge.source}|${edge.target}`) ?? edge.source;
    } else if (edge.kind === "output") {
      target = producerInstance.get(`${edge.target}|${edge.source}`) ?? edge.target;
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
    (edge) => !PROTOCOL_EDGE_SPEC[edge.data!.edge.kind],
  );
  const inPorts = new Map<string, number>();
  const outPorts = new Map<string, number>();
  for (const edge of valueEdges) {
    outPorts.set(edge.source, (outPorts.get(edge.source) ?? 0) + 1);
    inPorts.set(edge.target, (inPorts.get(edge.target) ?? 0) + 1);
  }
  const minPorts = opts?.connectablePorts ? 1 : 0;
  const inPortCount = (id: string) => Math.max(minPorts, inPorts.get(id) ?? 0);
  const outPortCount = (id: string) =>
    Math.max(minPorts, outPorts.get(id) ?? 0);
  const portCount = (id: string) =>
    Math.max(inPortCount(id), outPortCount(id));

  // Pill top ports render only when an edge actually uses them — otherwise
  // pills show stray unconnected dots. (Tx bottom ports are per-edge and
  // assigned after positioning; see the protoPorts pass below.)
  const usedProtoHandles = new Map<string, string[]>();
  const markProto = (nodeId: string, handle: string) => {
    const list = usedProtoHandles.get(nodeId) ?? [];
    if (!list.includes(handle)) usedProtoHandles.set(nodeId, [...list, handle]);
  };
  // Iterate the remapped edges so marks land on per-tx pill instances in
  // timeline mode (ids are unchanged in default mode).
  for (const edge of edges) {
    const spec = PROTOCOL_EDGE_SPEC[edge.data!.edge.kind];
    if (!spec) continue;
    markProto(spec.txIsSource ? edge.target : edge.source, spec.pillHandle);
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
    xOffset?: number;
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
      xOffset: instance.xOffset,
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
    if (PROTOCOL_EDGE_SPEC[edge.data!.edge.kind]) continue;
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
        position: { x: col * colWidth + (entry.xOffset ?? 0), y },
        data: {
          node: entry.node,
          inPortCount: inPortCount(entry.id),
          outPortCount: outPortCount(entry.id),
          ...(entry.role ? { instanceRole: entry.role } : {}),
          ...(entry.changeHint ? { changeHint: true } : {}),
          ...(opts?.testIdSuffix ? { testIdSuffix: opts.testIdSuffix } : {}),
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
  // Timeline mode renders each protocol role once PER touching tx — the
  // shared singleton would anchor mid-timeline and fan long sideways edges
  // to every tx (hiding the amount chips). Default mode keeps the shared
  // pill.
  const protocolNodes = flow.nodes.filter((node) => node.kind === "protocol");
  const bottomY = maxHeight + PROTOCOL_ROW_GAP;
  type ProtocolInstance = { id: string; node: FlowNode; txColumns: number[] };
  const protocolInstances: ProtocolInstance[] = [];
  for (const node of protocolNodes) {
    const touchingTxs = [
      ...new Set(
        flow.edges
          .filter((edge) => edge.source === node.id || edge.target === node.id)
          .map((edge) => (edge.source === node.id ? edge.target : edge.source)),
      ),
    ];
    const txCols = touchingTxs.map((txId) => column.get(txId) ?? 1);
    if (opts?.txOrder) {
      const seen = new Set<string>();
      for (const col of txCols) {
        const id = `${node.id}@c${col}`;
        if (seen.has(id)) continue;
        seen.add(id);
        protocolInstances.push({ id, node, txColumns: [col] });
      }
    } else {
      protocolInstances.push({ id: node.id, node, txColumns: txCols });
    }
  }
  const sortedProtocol = protocolInstances.sort((a, b) =>
    a.id < b.id ? -1 : 1,
  );
  const anchors = sortedProtocol.map((instance) => {
    const averageColumn =
      instance.txColumns.length > 0
        ? instance.txColumns.reduce((a, b) => a + b, 0) /
          instance.txColumns.length
        : 1;
    return averageColumn * colWidth + TX_BOTTOM_CENTER_OFFSET;
  });
  // Spread pills sharing (roughly) the same anchor so they never overlap.
  const anchorGroups = new Map<number, number[]>(); // rounded anchor -> indices
  anchors.forEach((anchor, i) => {
    const key = Math.round(anchor / 10) * 10;
    anchorGroups.set(key, [...(anchorGroups.get(key) ?? []), i]);
  });
  const pillX = new Map<string, number>();
  sortedProtocol.forEach((instance, i) => {
    const group = [...anchorGroups.values()].find((g) => g.includes(i))!;
    const posInGroup = group.indexOf(i);
    const x = anchors[i]! + (posInGroup - (group.length - 1) / 2) * PROTOCOL_SPACING;
    pillX.set(instance.id, x);
    positioned.push({
      id: instance.id,
      type: instance.node.kind,
      position: { x, y: bottomY },
      data: {
        node: instance.node,
        usedProtoHandles: usedProtoHandles.get(instance.id) ?? [],
        ...(opts?.testIdSuffix ? { testIdSuffix: opts.testIdSuffix } : {}),
      },
    });
  });

  // Per-edge bottom ports: every protocol edge gets its OWN connector on
  // its tx card (like value edges' side ports — no shared fan-out point),
  // ordered left → right by the x of the pill it connects to so the
  // vertical protocol edges never cross.
  const protoPortsByTx = new Map<
    string,
    { id: string; type: "source" | "target" }[]
  >();
  for (const tx of txIds) {
    const touching: { edge: Edge<TokenFlowEdgeData>; pillId: string }[] = [];
    for (const edge of edges) {
      if (!PROTOCOL_EDGE_SPEC[edge.data!.edge.kind]) continue;
      if (edge.source === tx) touching.push({ edge, pillId: edge.target });
      else if (edge.target === tx) touching.push({ edge, pillId: edge.source });
    }
    if (touching.length === 0) continue;
    touching.sort((a, b) => {
      const dx = (pillX.get(a.pillId) ?? 0) - (pillX.get(b.pillId) ?? 0);
      if (dx !== 0) return dx;
      return a.edge.id < b.edge.id ? -1 : 1;
    });
    protoPortsByTx.set(
      tx,
      touching.map(({ edge }, index) => {
        const isSource = edge.source === tx;
        const id = protoPort(index);
        if (isSource) edge.sourceHandle = id;
        else edge.targetHandle = id;
        return { id, type: isSource ? ("source" as const) : ("target" as const) };
      }),
    );
  }
  for (const node of positioned) {
    const ports = protoPortsByTx.get(node.id);
    if (ports) node.data.protoPorts = ports;
  }

  // --- Timeline event dividers --------------------------------------------
  // One per boundary between consecutive loaded txs. No line into unloaded
  // gaps: there is no join and nothing to separate there; lines simply
  // appear as neighbours load while card positions (driven by the always-on
  // lane offsets above) never move.
  const order = opts?.txOrder ?? [];
  const dividers: { index: number; x: number }[] = [];
  order.forEach((id, index) => {
    const next = order[index + 1];
    if (next !== undefined && nodesById.has(id) && nodesById.has(next)) {
      dividers.push({
        index,
        // The boundary column's unshifted card centerline, where joins stay.
        x: (2 * index + 2) * colWidth + ADDRESS_CARD_WIDTH / 2,
      });
    }
  });
  const bounds = {
    minY: 0,
    // 36 = protocol pill estimateHeight.
    maxY: protocolInstances.length > 0 ? bottomY + 36 : maxHeight,
  };

  return { nodes: positioned, edges, txLayer: layer, dividers, bounds };
}
