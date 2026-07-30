import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ArrowLeftRight, ExternalLink } from "lucide-react";

import LinkCardanoscan from "@/components/common/link-cardanoscan";
import type { TransactionFlowNode } from "@/types/token-flow";
import { getFirstAndLast, numberWithCommas } from "@/utils/strings";
import { cn } from "@/lib/utils";
import {
  HANDLES,
  portStackHeight,
  portTopPercent,
  valuePortIn,
  valuePortOut,
} from "../handles";

export default function TransactionNode({ id, data }: NodeProps) {
  const {
    node,
    inPortCount = 1,
    outPortCount = 1,
    usedProtoHandles = [],
  } = data as {
    node: TransactionFlowNode;
    inPortCount?: number;
    outPortCount?: number;
    usedProtoHandles?: string[];
  };
  const protoOut = usedProtoHandles.includes(HANDLES.transaction.protoOut);
  const protoIn = usedProtoHandles.includes(HANDLES.transaction.protoIn);
  return (
    <div
      data-testid={`tx-flow-node-${id}`}
      // One connector per input/output edge; the card stretches so the
      // taller port stack keeps its dots evenly spaced.
      style={{ minHeight: portStackHeight(Math.max(inPortCount, outPortCount)) }}
      className="flex w-[240px] flex-col justify-center rounded-lg border border-primary/40 bg-card px-3 py-2 shadow-md"
    >
      {Array.from({ length: inPortCount }, (_, i) => (
        <Handle
          key={valuePortIn(i)}
          type="target"
          position={Position.Left}
          id={valuePortIn(i)}
          style={{ top: `${portTopPercent(i, inPortCount)}%` }}
          className="!bg-primary"
        />
      ))}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">{node.label || "Transaction"}</span>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
            node.status === "pending"
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : "bg-green-500/15 text-green-600 dark:text-green-400",
          )}
        >
          {node.status === "pending" ? "Pending" : "On-chain"}
        </span>
      </div>
      {node.txHash && (
        <LinkCardanoscan
          url={`transaction/${node.txHash}`}
          className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
        >
          <span className="truncate">{getFirstAndLast(node.txHash, 10, 6)}</span>
          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
        </LinkCardanoscan>
      )}
      {node.status === "onchain" && node.blockHeight !== undefined && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          Block {numberWithCommas(node.blockHeight)}
        </div>
      )}
      {/* The fee itself is shown on the edge to the Network-fee pill, not
          repeated on the card. */}
      {node.badges.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {node.badges.map((badge, i) => (
            <span
              key={i}
              title={badge.detail}
              className={cn(
                "rounded-full border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium",
                badge.color ?? "text-muted-foreground",
              )}
            >
              {badge.label}
            </span>
          ))}
        </div>
      )}
      {Array.from({ length: outPortCount }, (_, i) => (
        <Handle
          key={valuePortOut(i)}
          type="source"
          position={Position.Right}
          id={valuePortOut(i)}
          style={{ top: `${portTopPercent(i, outPortCount)}%` }}
          className="!bg-primary"
        />
      ))}
      {/* Bottom ports: protocol edges (fee/deposit/burn out, mint/refund in)
          drop vertically to the protocol pills beneath the card. Only ports
          an edge actually uses are rendered; a lone port sits centered. */}
      {protoOut && (
        <Handle
          type="source"
          position={Position.Bottom}
          id={HANDLES.transaction.protoOut}
          style={{ left: protoIn ? "38%" : "50%" }}
          className="!bg-muted-foreground"
        />
      )}
      {protoIn && (
        <Handle
          type="target"
          position={Position.Bottom}
          id={HANDLES.transaction.protoIn}
          style={{ left: protoOut ? "62%" : "50%" }}
          className="!bg-muted-foreground"
        />
      )}
    </div>
  );
}
