import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getStraightPath,
  type EdgeProps,
} from "@xyflow/react";

import type { FlowEdge } from "@/types/token-flow";
import { cn } from "@/lib/utils";
import { formatAssetQuantity, type AssetMetadataMap } from "../format";

const MAX_ASSET_LINES = 3;

/**
 * Bezier edge with a chip listing the assets moving along it. Asset metadata
 * for formatting is injected per-edge via `data.assetMetadata` (React Flow
 * edges only receive props through `data`).
 */
export default function AssetEdge(props: EdgeProps) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    style,
  } = props;
  const data = props.data as
    | {
        edge: FlowEdge;
        assetMetadata?: AssetMetadataMap;
      }
    | undefined;
  const edge = data?.edge;

  // Protocol edges are (near-)vertical drops between a tx card's bottom
  // ports and the protocol pill beneath it — a straight line reads cleaner
  // than a bezier there. Value edges keep the horizontal bezier flow; each
  // one attaches to its own connector port, so paths never stack.
  const isProtocolEdge =
    edge?.kind === "fee" ||
    edge?.kind === "deposit" ||
    edge?.kind === "burn" ||
    edge?.kind === "deposit-refund" ||
    edge?.kind === "mint";
  const [edgePath, labelX, labelY] = isProtocolEdge
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })
    : getBezierPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
      });

  const isDebit =
    edge?.kind === "fee" || edge?.kind === "deposit" || edge?.kind === "burn";
  const shown = edge?.assets.slice(0, MAX_ASSET_LINES) ?? [];
  const hidden = (edge?.assets.length ?? 0) - shown.length;

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {edge && (shown.length > 0 || edge.note) && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            title={shown.length > 0 ? edge.note : undefined}
            className={cn(
              "absolute rounded-md border border-border/60 bg-card/95 px-1.5 py-0.5 text-[10px] font-medium shadow-sm",
              // Chips are inert except when they carry a note tooltip (the
              // UTxO ref on per-input edges), which needs hover events.
              shown.length > 0 && edge.note
                ? "pointer-events-auto"
                : "pointer-events-none",
              isDebit ? "text-red-500 dark:text-red-400" : "text-foreground",
            )}
          >
            {shown.map((asset) => (
              <div key={asset.unit} className="whitespace-nowrap">
                {formatAssetQuantity(asset, data?.assetMetadata)}
              </div>
            ))}
            {hidden > 0 && (
              <div className="text-muted-foreground">+{hidden} more</div>
            )}
            {shown.length === 0 && edge.note && (
              <div className="italic text-muted-foreground">{edge.note}</div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
