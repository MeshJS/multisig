import { describe, expect, it } from "@jest/globals";
import type { Node } from "@xyflow/react";

import type { TokenFlowNodeData } from "@/components/common/token-flow/layout";
import {
  handleSignature,
  syncMeasuredNodes,
} from "@/components/common/token-flow/measured-nodes";
import type { FlowNode } from "@/types/token-flow";

type CanvasNode = Node<TokenFlowNodeData>;

const flowNode = { kind: "address" } as unknown as FlowNode;

function card(
  id: string,
  data: Partial<TokenFlowNodeData> = {},
  extra: Partial<CanvasNode> = {},
): CanvasNode {
  return {
    id,
    type: "address",
    position: { x: 0, y: 0 },
    data: { node: flowNode, inPortCount: 1, outPortCount: 1, ...data },
    ...extra,
  };
}

const measured = { width: 220, height: 64 };

describe("syncMeasuredNodes", () => {
  it("keeps a measured card's size when the layout recomputes it", () => {
    const current = [card("draftout:a", {}, { measured })];
    const computed = [card("draftout:a", {}, { position: { x: 40, y: 10 } })];

    const { nodes, remeasure } = syncMeasuredNodes(current, computed);

    // The card stays visible: React Flow hides nodes without `measured`.
    expect(nodes[0]!.measured).toEqual(measured);
    // Everything else comes from the new layout.
    expect(nodes[0]!.position).toEqual({ x: 40, y: 10 });
    expect(remeasure).toEqual([]);
  });

  it("leaves brand-new cards unmeasured so React Flow measures them on mount", () => {
    const { nodes, remeasure } = syncMeasuredNodes(
      [card("draftout:a", {}, { measured })],
      [card("draftout:a"), card("draftout:b")],
    );

    expect(nodes[1]!.measured).toBeUndefined();
    expect(remeasure).toEqual([]);
  });

  it("does not invent a size for a card that was never fully measured", () => {
    const { nodes } = syncMeasuredNodes(
      [card("draftout:a", {}, { measured: { width: 220 } })],
      [card("draftout:a")],
    );

    expect(nodes[0]!.measured).toBeUndefined();
  });

  it("drops cards that left the layout", () => {
    const { nodes } = syncMeasuredNodes(
      [
        card("draftout:a", {}, { measured }),
        card("draftout:b", {}, { measured }),
      ],
      [card("draftout:b")],
    );

    expect(nodes.map((node) => node.id)).toEqual(["draftout:b"]);
  });

  it("asks for a re-measure when a kept card's connector dots move", () => {
    const { nodes, remeasure } = syncMeasuredNodes(
      [card("txd:1", { outPortCount: 1 }, { measured })],
      [card("txd:1", { outPortCount: 2 })],
    );

    // Still visible while React Flow re-reads the handle positions.
    expect(nodes[0]!.measured).toEqual(measured);
    expect(remeasure).toEqual(["txd:1"]);
  });

  it("does not re-measure a card whose handles are unchanged", () => {
    const { remeasure } = syncMeasuredNodes(
      [card("addr:x", { changeHint: false }, { measured })],
      [card("addr:x", { changeHint: true })],
    );

    expect(remeasure).toEqual([]);
  });
});

describe("handleSignature", () => {
  it("changes with port counts and protocol ports", () => {
    const base = handleSignature({ node: flowNode, inPortCount: 1 });

    expect(handleSignature({ node: flowNode, inPortCount: 2 })).not.toBe(base);
    expect(
      handleSignature({
        node: flowNode,
        inPortCount: 1,
        protoPorts: [{ id: "proto-0", type: "source" }],
      }),
    ).not.toBe(base);
    expect(
      handleSignature({
        node: flowNode,
        inPortCount: 1,
        usedProtoHandles: ["top-in"],
      }),
    ).not.toBe(base);
  });

  it("ignores card content that does not position handles", () => {
    expect(
      handleSignature({ node: flowNode, inPortCount: 1, changeHint: true }),
    ).toBe(handleSignature({ node: flowNode, inPortCount: 1 }));
  });
});
