import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Landmark, User, Users, FileCode2, Coins, Wallet } from "lucide-react";

import type { AddressFlowNode, AddressPartyType } from "@/types/token-flow";
import { getFirstAndLast } from "@/utils/strings";
import { cn } from "@/lib/utils";
import { HANDLES } from "../handles";

const PARTY_STYLES: Record<
  AddressPartyType,
  { border: string; text: string; icon: typeof Wallet; fallbackLabel: string }
> = {
  self: {
    border: "border-blue-500/50",
    text: "text-blue-500 dark:text-blue-400",
    icon: Landmark,
    fallbackLabel: "Self (Multisig)",
  },
  signer: {
    border: "border-green-500/50",
    text: "text-green-500 dark:text-green-400",
    icon: User,
    fallbackLabel: "Signer",
  },
  contact: {
    border: "border-purple-500/50",
    text: "text-purple-500 dark:text-purple-400",
    icon: Users,
    fallbackLabel: "Contact",
  },
  script: {
    border: "border-amber-500/50",
    text: "text-amber-500 dark:text-amber-400",
    icon: FileCode2,
    fallbackLabel: "Script",
  },
  reward: {
    border: "border-teal-500/50",
    text: "text-teal-500 dark:text-teal-400",
    icon: Coins,
    fallbackLabel: "Reward account",
  },
  unknown: {
    border: "border-border",
    text: "text-muted-foreground",
    icon: Wallet,
    fallbackLabel: "External address",
  },
};

export default function AddressNode({ id, data }: NodeProps) {
  const { node, changeHint } = data as {
    node: AddressFlowNode;
    changeHint?: boolean;
  };
  const style = PARTY_STYLES[node.partyType] ?? PARTY_STYLES.unknown;
  const Icon = style.icon;
  return (
    <div
      // React Flow node id, not node.id: split instances (@in/@out) must
      // render unique testids.
      data-testid={`tx-flow-node-${id}`}
      className={cn(
        "w-[220px] rounded-lg border bg-card px-3 py-2 shadow-sm",
        style.border,
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLES.address.in}
        className="!bg-muted-foreground"
      />
      <div className={cn("flex items-center gap-1.5 text-xs font-medium", style.text)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.label || style.fallbackLabel}</span>
        {changeHint && (
          <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400">
            change
          </span>
        )}
      </div>
      {node.address && (
        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {getFirstAndLast(node.address, 12, 6)}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLES.address.out}
        className="!bg-muted-foreground"
      />
    </div>
  );
}
