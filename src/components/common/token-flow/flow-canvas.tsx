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

const NODE_TYPES = {
  address: AddressNode,
  transaction: TransactionNode,
  protocol: ProtocolNode,
};

const EDGE_TYPES = {
  asset: AssetEdge,
};

const FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 1 };

/** Restores the computed layout after the user has dragged nodes around. */
function ResetLayoutButton({ onReset }: { onReset: () => void }) {
  const { fitView } = useReactFlow();
  return (
    <Panel position="top-right">
      <button
        type="button"
        data-testid="tx-flow-reset"
        title="Reset layout"
        onClick={() => {
          onReset();
          // Refit once the restored positions have been applied.
          window.requestAnimationFrame(() => void fitView(FIT_VIEW_OPTIONS));
        }}
        className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card/90 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <RotateCcw className="h-3 w-3" />
        Reset layout
      </button>
    </Panel>
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
        colorMode="dark"
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
        <ResetLayoutButton onReset={() => setNodes(layoutNodes)} />
      </ReactFlow>
    </div>
  );
}
