import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import {
  EDGE_TYPES,
  FIT_VIEW_OPTIONS,
  NODE_TYPES,
  ResetLayoutButton,
} from "@/components/common/token-flow/flow-canvas";
import {
  isValuePortIn,
  isValuePortOut,
} from "@/components/common/token-flow/handles";
import type { AssetMetadataMap } from "@/components/common/token-flow/format";
import {
  layoutTokenFlow,
  type TokenFlowEdgeData,
  type TokenFlowNodeData,
} from "@/components/common/token-flow/layout";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import type { AddressLabeler } from "@/types/token-flow";
import type { BuilderSelection, TxDraft } from "@/types/tx-draft";
import { draftToTokenFlow, flowIdToDraftEntity } from "@/utils/token-flow";
import { cn } from "@/lib/utils";
import BuilderPalette, { type PaletteEntry } from "./palette";

export type BuilderCanvasProps = {
  walletAddress: string;
  labelAddress: AddressLabeler;
  walletAssetMetadata?: AssetMetadataMap;
  contacts: PaletteEntry[];
  signers: PaletteEntry[];
  /** Resolves "txHash#certIndex" to a proposal title for vote badges. */
  resolveProposalTitle?: (proposalId: string) => string | undefined;
  /** Resolves a bech32 pool id to a pool name for delegation badges. */
  resolvePoolName?: (poolId: string) => string | undefined;
  /** Opens the add-stake-action dialog owned by the page. */
  onAddStakeAction: () => void;
  /** When set, the stake button is disabled with this tooltip. */
  addStakeDisabledReason?: string;
  /** Opens the add-vote dialog owned by the page. */
  onAddVote: () => void;
  /** When set, the vote button is disabled with this tooltip. */
  addVoteDisabledReason?: string;
  className?: string;
};

/**
 * Position overrides are keyed by draft ENTITY, not React Flow node id, so a
 * dragged placeholder keeps its spot when setting its address renames the
 * node from `draftout:<id>` to `addr:<bech32>` (possibly with a layout
 * `@in`/`@out` instance suffix).
 */
function positionKeyForNode(draft: TxDraft, nodeId: string): string {
  const suffixMatch = /@(in|out)$/.exec(nodeId);
  const baseId = suffixMatch ? nodeId.slice(0, suffixMatch.index) : nodeId;
  if (baseId.startsWith("txd:")) return "tx";
  if (baseId.startsWith("draftout:")) {
    return `out:${baseId.slice("draftout:".length)}`;
  }
  if (baseId.startsWith("addr:") && suffixMatch?.[1] !== "in") {
    const address = baseId.slice("addr:".length);
    const output = draft.outputs.find((o) => o.address === address);
    if (output) return `out:${output.id}`;
  }
  // Input-side and change-only nodes: keyed by their full React Flow id.
  return nodeId;
}

function sameSelection(a: BuilderSelection, b: BuilderSelection): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "tx" || a.outputId === (b as { outputId: string }).outputId;
}

/**
 * Interactive canvas for the transaction builder. The TxDraft in the zustand
 * store is the source of truth; this component renders `draftToTokenFlow`
 * through the shared layout and maps gestures (connect, drag, click, delete)
 * back to draft mutations. Rendering is fully controlled — user-dragged
 * positions live in the store as entity-keyed overrides, so draft edits
 * never make cards jump (unlike the read-only viz, which resets positions
 * whenever its flow changes).
 */
export default function BuilderCanvas({
  walletAddress,
  labelAddress,
  walletAssetMetadata,
  contacts,
  signers,
  resolveProposalTitle,
  resolvePoolName,
  onAddStakeAction,
  addStakeDisabledReason,
  onAddVote,
  addVoteDisabledReason,
  className,
}: BuilderCanvasProps) {
  const draft = useTxBuilderStore((state) => state.draft);
  const selection = useTxBuilderStore((state) => state.selection);
  const positions = useTxBuilderStore((state) => state.positions);
  const select = useTxBuilderStore((state) => state.select);
  const setPosition = useTxBuilderStore((state) => state.setPosition);
  const clearPositions = useTxBuilderStore((state) => state.clearPositions);
  const addOutput = useTxBuilderStore((state) => state.addOutput);
  const removeOutput = useTxBuilderStore((state) => state.removeOutput);

  const flow = useMemo(
    () =>
      draftToTokenFlow(draft, {
        labelAddress,
        walletAddress,
        resolveProposalTitle,
        resolvePoolName,
      }),
    [draft, labelAddress, walletAddress, resolveProposalTitle, resolvePoolName],
  );
  // connectablePorts: empty card sides keep a dot as the drag-to-connect
  // source/drop target (viewer canvases render none there).
  const layout = useMemo(
    () => layoutTokenFlow(flow, { connectablePorts: true }),
    [flow],
  );

  const computedNodes = useMemo(
    () =>
      layout.nodes.map((node) => {
        const entity = flowIdToDraftEntity(draft, node.id);
        // Highlight the card the inspector is editing. The tx selection only
        // highlights the tx card itself, not the input-side address nodes
        // that also resolve to it.
        const highlighted =
          selection !== null &&
          sameSelection(entity, selection) &&
          (selection.kind !== "tx" || node.data.node.kind === "transaction");
        return {
          ...node,
          position: positions[positionKeyForNode(draft, node.id)] ?? node.position,
          className: highlighted
            ? "rounded-lg ring-2 ring-primary/70"
            : undefined,
        };
      }),
    [layout.nodes, draft, positions, selection],
  );

  const edges = useMemo(
    () =>
      layout.edges.map((edge) => ({
        ...edge,
        data: { ...edge.data, assetMetadata: walletAssetMetadata },
      })) as Edge<TokenFlowEdgeData>[],
    [layout.edges, walletAssetMetadata],
  );

  // Local node state exists only so dragging is smooth; it re-syncs from the
  // computed projection (draft + overrides) after every change.
  const [nodes, setNodes] = useState<Node<TokenFlowNodeData>[]>(computedNodes);
  useEffect(() => {
    setNodes(computedNodes);
  }, [computedNodes]);
  const onNodesChange = useCallback(
    (changes: NodeChange<Node<TokenFlowNodeData>>[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) =>
      setPosition(positionKeyForNode(draft, node.id), node.position),
    [draft, setPosition],
  );

  const isTxNode = useCallback(
    (id: string | null) => id === `txd:${draft.id}`,
    [draft.id],
  );

  // Bipartite, v1-scoped gestures: tx→address (value handles only) adds or
  // targets an output; input-side address→tx focuses the tx inspector.
  // Output-side recipient cards can't be wired back into the tx — the wallet
  // is the only spending source in v1.
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!source || !target) return false;
      if (isTxNode(source)) {
        return (
          isValuePortOut(sourceHandle) &&
          isValuePortIn(targetHandle) &&
          (target.startsWith("addr:") || target.startsWith("draftout:"))
        );
      }
      if (isTxNode(target)) {
        return (
          isValuePortOut(sourceHandle) &&
          isValuePortIn(targetHandle) &&
          flowIdToDraftEntity(draft, source)?.kind === "tx"
        );
      }
      return false;
    },
    [draft, isTxNode],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const { source, target } = connection;
      if (!source || !target) return;
      if (isTxNode(source)) {
        const entity = flowIdToDraftEntity(draft, target);
        if (entity?.kind === "output") {
          select(entity); // already an output — just open it
          return;
        }
        const suffixMatch = /@(in|out)$/.exec(target);
        const baseId = suffixMatch ? target.slice(0, suffixMatch.index) : target;
        if (baseId.startsWith("addr:")) {
          addOutput({ address: baseId.slice("addr:".length) });
        }
        return;
      }
      if (isTxNode(target)) {
        select({ kind: "tx" });
      }
    },
    [draft, isTxNode, select, addOutput],
  );

  const onElementClick = useCallback(
    (_event: unknown, element: { id: string }) =>
      select(flowIdToDraftEntity(draft, element.id)),
    [draft, select],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      if (selection?.kind === "output") removeOutput(selection.outputId);
    },
    [selection, removeOutput],
  );

  return (
    <div
      data-testid="tx-builder-canvas"
      className={cn("h-full w-full", className)}
      onKeyDown={onKeyDown}
    >
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        colorMode="system"
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable
        nodesConnectable
        elementsSelectable={false}
        isValidConnection={isValidConnection}
        onConnect={onConnect}
        onNodeClick={onElementClick}
        onEdgeClick={onElementClick}
        onPaneClick={() => select(null)}
        zoomOnScroll
        zoomOnPinch
        panOnDrag
        proOptions={{ hideAttribution: false }}
        className="!bg-muted/20 rounded-lg border border-border/50"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <BuilderPalette
          contacts={contacts}
          signers={signers}
          selfAddress={walletAddress}
          onAddStakeAction={onAddStakeAction}
          addStakeDisabledReason={addStakeDisabledReason}
          onAddVote={onAddVote}
          addVoteDisabledReason={addVoteDisabledReason}
        />
        <Panel position="top-right">
          <ResetLayoutButton
            onReset={clearPositions}
            data-testid="tx-builder-reset"
          />
        </Panel>
      </ReactFlow>
    </div>
  );
}
