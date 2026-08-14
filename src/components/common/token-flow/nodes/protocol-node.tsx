import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Flame, Landmark, Sparkles } from "lucide-react";

import type { ProtocolFlowNode } from "@/types/token-flow";
import { HANDLES } from "../handles";

const ROLE_ICONS = {
  fee: Flame,
  deposit: Landmark,
  mint: Sparkles,
} as const;

export default function ProtocolNode({ id, data }: NodeProps) {
  const { node, usedProtoHandles = [], testIdSuffix = "" } = data as {
    node: ProtocolFlowNode;
    usedProtoHandles?: string[];
    testIdSuffix?: string;
  };
  const Icon = ROLE_ICONS[node.role] ?? Flame;
  const topIn = usedProtoHandles.includes(HANDLES.protocol.topIn);
  const topOut = usedProtoHandles.includes(HANDLES.protocol.topOut);
  return (
    <div
      data-testid={`tx-flow-node-${id}${testIdSuffix}`}
      className="rounded-full border border-dashed border-border bg-muted/40 px-3 py-1.5 shadow-sm"
    >
      {/* Top ports: protocol pills hang beneath their transaction, so both
          directions connect upward. Only ports an edge actually uses are
          rendered; a lone port sits centered. */}
      {topIn && (
        <Handle
          type="target"
          position={Position.Top}
          id={HANDLES.protocol.topIn}
          style={{ left: topOut ? "40%" : "50%" }}
          className="!bg-muted-foreground"
        />
      )}
      {topOut && (
        <Handle
          type="source"
          position={Position.Top}
          id={HANDLES.protocol.topOut}
          style={{ left: topIn ? "60%" : "50%" }}
          className="!bg-muted-foreground"
        />
      )}
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" />
        <span>{node.label}</span>
      </div>
    </div>
  );
}
