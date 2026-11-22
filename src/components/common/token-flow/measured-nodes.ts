import type { Node } from "@xyflow/react";

import type { TokenFlowNodeData } from "./layout";

/**
 * Everything about a card that decides WHERE its connector dots sit. Content
 * changes that resize the card are caught by React Flow's ResizeObserver,
 * which re-reads the handles too; a change in port count or protocol ports
 * can move the dots without resizing the card, so it needs an explicit
 * re-measure.
 */
export function handleSignature(data: TokenFlowNodeData | undefined): string {
  return JSON.stringify([
    data?.inPortCount ?? null,
    data?.outPortCount ?? null,
    data?.usedProtoHandles ?? [],
    data?.protoPorts ?? [],
  ]);
}

export type MeasuredNodesSync<N extends Node<TokenFlowNodeData>> = {
  nodes: N[];
  /** Ids whose handles moved: call React Flow's updateNodeInternals on them. */
  remeasure: string[];
};

/**
 * Re-syncs a controlled canvas's local nodes from a freshly computed layout
 * WITHOUT throwing away React Flow's measurements.
 *
 * React Flow renders a node with `visibility: hidden` until it has a
 * `measured` size, and only re-observes a node's DOM element when the node
 * goes from measured to unmeasured in a committed render. Replacing the nodes
 * with measurement-less copies on every layout change therefore re-arms a
 * measurement each time — and when two such resets land before React commits
 * the measured state in between (a burst of async data arriving while the
 * builder loads a deep-linked transaction), the ResizeObserver has already
 * delivered its one callback, nothing re-observes, and the card stays
 * invisible forever. Carrying `measured` over for nodes that still exist keeps
 * them visible across layout changes; brand-new ids are measured on mount.
 */
export function syncMeasuredNodes<N extends Node<TokenFlowNodeData>>(
  current: readonly Node<TokenFlowNodeData>[],
  computed: readonly N[],
): MeasuredNodesSync<N> {
  const previous = new Map(current.map((node) => [node.id, node]));
  const remeasure: string[] = [];
  const nodes = computed.map((node) => {
    const before = previous.get(node.id);
    const measured = before?.measured;
    if (
      !before ||
      measured?.width === undefined ||
      measured.height === undefined
    ) {
      return node;
    }
    if (handleSignature(before.data) !== handleSignature(node.data)) {
      remeasure.push(node.id);
    }
    return { ...node, measured };
  });
  return { nodes, remeasure };
}
