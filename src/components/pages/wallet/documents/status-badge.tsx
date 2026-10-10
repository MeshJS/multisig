import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** The six lifecycle states from PRD-001, with a consistent colour per state. */
const STATUS_STYLES: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  InReview: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  Approved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  Rejected: "bg-red-500/15 text-red-600 dark:text-red-400",
  Superseded: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  Archived: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  Draft: "Draft",
  InReview: "In review",
  Approved: "Approved",
  Rejected: "Rejected",
  Superseded: "Superseded",
  Archived: "Archived",
};

export default function DocumentStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(STATUS_STYLES[status] ?? "", "border-0", className)}
    >
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
