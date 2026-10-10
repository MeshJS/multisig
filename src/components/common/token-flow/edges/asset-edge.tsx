import Image from "next/image";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getStraightPath,
  type EdgeProps,
} from "@xyflow/react";

import type { FlowEdge } from "@/types/token-flow";
import { IPFSImage } from "@/components/common/ipfs-image";
import { cn } from "@/lib/utils";
import { describeAsset, type AssetMetadataMap } from "../format";

const MAX_ASSET_LINES = 3;

/** ~14px token/NFT thumbnail; same source branching as the assets page
 *  (ipfs:// ref via gateway, anything else is a base64 payload). */
function AssetThumb({ image, alt }: { image: string; alt: string }) {
  const className = "h-3.5 w-3.5 shrink-0 rounded-[3px] object-cover";
  return image.startsWith("ipfs://") ? (
    <IPFSImage
      src={image}
      alt={alt}
      width={14}
      height={14}
      className={className}
    />
  ) : (
    <Image
      src={`data:image/jpeg;base64, ${image}`}
      alt={alt}
      width={14}
      height={14}
      unoptimized
      className={className}
    />
  );
}

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
            {shown.map((asset) => {
              const desc = describeAsset(asset, data?.assetMetadata);
              return (
                <div
                  key={asset.unit}
                  className="flex items-center gap-1 whitespace-nowrap"
                >
                  {desc.image && (
                    <AssetThumb image={desc.image} alt={desc.text} />
                  )}
                  <span>{desc.text}</span>
                  {desc.isNft && (
                    <span className="shrink-0 rounded-sm bg-muted/60 px-0.5 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
                      NFT
                    </span>
                  )}
                </div>
              );
            })}
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
