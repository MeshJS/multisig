import { useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { RotateCcw } from "lucide-react";

import "@xyflow/react/dist/style.css";

import type { TokenFlow } from "@/types/token-flow";
import { cn } from "@/lib/utils";
import AssetEdge from "./edges/asset-edge";
import type { AssetMetadataMap } from "./format";
import { layoutTokenFlow } from "./layout";
import AddressNode from "./nodes/address-node";
import ProtocolNode from "./nodes/protocol-node";
import TransactionNode from "./nodes/transaction-node";

// Shared with the transaction-builder canvas (builder-canvas.tsx), which
// renders the same cards/edges with its own interaction model.
export const NODE_TYPES = {
  address: AddressNode,
  transaction: TransactionNode,
  protocol: ProtocolNode,
};

export const EDGE_TYPES = {
  asset: AssetEdge,
};

export const FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 1 };

// Shared button chrome for the small canvas-corner controls (reset layout,
// timeline expand, …).
export const CANVAS_BUTTON_CLASS =
  "flex items-center gap-1.5 rounded-md border border-border/60 bg-card/75 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-muted/60 hover:text-foreground";

// Shared glass chrome for static panels floating over the canvas dot grid.
// backdrop-blur is reserved for these few static overlays: blurring
// draggable nodes/edge chips forces per-frame compositing during drag/pan
// and shimmers under React Flow's zoom transform.
export const GLASS_PANEL_CLASS =
  "border border-border/60 bg-card/75 shadow-md backdrop-blur-md";

// Glass variant for DialogContent: swaps only the surface (border color,
// translucent bg, heavier blur since body text sits over blurred page
// content) and keeps the dialog's own sizing/shadow/animation classes —
// tailwind-merge resolves these against DialogContent's base bg-background.
export const GLASS_DIALOG_CLASS =
  "border-border/60 bg-card/75 backdrop-blur-xl";

/**
 * Restores the computed layout after the user has dragged nodes around.
 * Rendered without its own Panel so surfaces can group it with other
 * controls; must sit inside a ReactFlow (uses useReactFlow).
 */
export function ResetLayoutButton({
  onReset,
  "data-testid": dataTestId = "tx-flow-reset",
}: {
  onReset: () => void;
  "data-testid"?: string;
}) {
  const { fitView } = useReactFlow();
  return (
    <button
      type="button"
      data-testid={dataTestId}
      title="Reset layout"
      aria-label="Reset layout"
      onClick={() => {
        onReset();
        // Refit once the restored positions have been applied.
        window.requestAnimationFrame(() => void fitView(FIT_VIEW_OPTIONS));
      }}
      className={CANVAS_BUTTON_CLASS}
    >
      <RotateCcw className="h-3 w-3" />
      {/* Icon-only on phones so the top-left palette keeps its room. */}
      <span className="hidden sm:inline">Reset layout</span>
    </button>
  );
}

export type TokenFlowVizProps = {
  flow: TokenFlow;
  walletAssetMetadata?: AssetMetadataMap;
  className?: string;
  /** Reserved for the future transaction-builder; read-only when false. */
  interactive?: boolean;
  "data-testid"?: string;
};

export default function FlowCanvas({
  flow,
  walletAssetMetadata,
  className,
  interactive = false,
  "data-testid": dataTestId,
}: TokenFlowVizProps) {
  const { nodes: layoutNodes, edges } = useMemo(() => {
    const layout = layoutTokenFlow(flow);
    return {
      nodes: layout.nodes,
      edges: layout.edges.map((edge) => ({
        ...edge,
        data: { ...edge.data, assetMetadata: walletAssetMetadata },
      })),
    };
  }, [flow, walletAssetMetadata]);

  // Node positions are stateful so users can drag cards around; a new flow
  // resets to the computed layout.
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  useEffect(() => {
    setNodes(layoutNodes);
  }, [layoutNodes, setNodes]);

  return (
    <div
      data-testid={dataTestId}
      className={cn("h-72 w-full sm:h-80", className)}
    >
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        // "system" matches _app.tsx, which derives html.dark from the same
        // prefers-color-scheme query — no drift possible without a manual
        // theme toggle.
        colorMode="system"
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable
        nodesConnectable={interactive}
        elementsSelectable={interactive}
        zoomOnScroll={false}
        preventScrolling={false}
        zoomOnPinch
        panOnDrag
        proOptions={{ hideAttribution: false }}
        className="!bg-muted/20 rounded-lg border border-border/50"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Panel position="top-right">
          <ResetLayoutButton onReset={() => setNodes(layoutNodes)} />
        </Panel>
      </ReactFlow>
    </div>
  );
}
