import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Flame, Landmark, Sparkles } from "lucide-react";

import type { ProtocolFlowNode } from "@/types/token-flow";

const ROLE_ICONS = {
  fee: Flame,
  deposit: Landmark,
  mint: Sparkles,
} as const;

export default function ProtocolNode({ data }: NodeProps) {
  const node = (data as { node: ProtocolFlowNode }).node;
  const Icon = ROLE_ICONS[node.role] ?? Flame;
  return (
    <div
      data-testid={`tx-flow-node-${node.id}`}
      className="rounded-full border border-dashed border-border bg-muted/40 px-3 py-1.5 shadow-sm"
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" />
        <span>{node.label}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    </div>
  );
}
