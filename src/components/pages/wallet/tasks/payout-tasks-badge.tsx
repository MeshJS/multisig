import Link from "next/link";
import { SquareKanban } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * "Payout for N tasks" on a pending/submitted transaction card, from the
 * `tasks` namespace the payout flow stamps into txJson. Renders nothing for
 * every other transaction.
 */
export default function PayoutTasksBadge({
  txJson,
  walletId,
}: {
  txJson: unknown;
  walletId: string;
}) {
  const taskIds = (txJson as { tasks?: { taskIds?: unknown } } | null)?.tasks?.taskIds;
  if (!Array.isArray(taskIds) || taskIds.length === 0) return null;
  const count = taskIds.length;
  return (
    <Link
      href={`/wallets/${walletId}/tasks`}
      className="text-muted-foreground transition-colors hover:text-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <Badge variant="outline" className="gap-1 font-medium" data-testid="payout-tasks-badge">
        <SquareKanban className="h-3 w-3" />
        Payout for {count} {count === 1 ? "task" : "tasks"}
      </Badge>
    </Link>
  );
}
