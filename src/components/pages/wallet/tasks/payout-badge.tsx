import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PAYOUT_STATE_LABELS, type TaskPayoutState } from "@/lib/task-payout/state";

/** Payout state as a chip; same palette as the document status badge. */
const STATE_STYLES: Record<TaskPayoutState, string> = {
  none: "",
  ready: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  pending: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  paid: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};

export default function PayoutBadge({
  state,
  payoutReady,
  className,
}: {
  state: TaskPayoutState;
  payoutReady: boolean;
  className?: string;
}) {
  if (state === "none") return null;
  const configured = state === "ready" && !payoutReady;
  return (
    <Badge
      variant="secondary"
      className={cn(
        configured ? "bg-muted text-muted-foreground" : (STATE_STYLES[state] ?? ""),
        "border-0",
        className,
      )}
      data-testid={configured ? "payout-badge-configured" : `payout-badge-${state}`}
    >
      {configured ? "Payment configured" : PAYOUT_STATE_LABELS[state]}
    </Badge>
  );
}
