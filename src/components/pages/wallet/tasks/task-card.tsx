import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, CalendarDays, ExternalLink, MoreVertical, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AddressLabeler } from "@/types/token-flow";

import { formatTotals, isPayoutReady, type AssetMetadataLookup } from "./board-model";
import PayoutBadge from "./payout-badge";
import { COLUMNS, type BoardTask, type TaskStatus } from "./types";

export type TaskCardProps = {
  task: BoardTask;
  walletId: string;
  metadata: AssetMetadataLookup;
  labelAddress: AddressLabeler;
  selected: boolean;
  onToggleSelect: (id: string, selected: boolean) => void;
  onOpen: (task: BoardTask) => void;
  onMove: (id: string, status: TaskStatus, position: number) => void;
  /** Rendered inside the DragOverlay: no sortable hooks, no interactions. */
  overlay?: boolean;
};

/** Outline chips, same palette as the address-kind and status badges. */
const PRIORITY_STYLES: Record<string, string> = {
  High: "border-red-500 text-red-600 dark:text-red-400",
  Medium: "border-amber-500 text-amber-600 dark:text-amber-400",
  Low: "border-muted-foreground/40 text-muted-foreground",
};

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

export function TaskCardBody({
  task,
  walletId,
  metadata,
  labelAddress,
  selected,
  onToggleSelect,
  onOpen,
  onMove,
  overlay,
  dragging,
}: TaskCardProps & { dragging?: boolean }) {
  const totals = formatTotals(task.recipients, metadata);
  const ready = isPayoutReady(task);
  const assignee = task.assigneeAddress
    ? labelAddress(task.assigneeAddress).label || `${task.assigneeAddress.slice(0, 12)}…`
    : null;
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const overdue = due !== null && task.status !== "Done" && due.getTime() < Date.now();

  return (
    <Card
      // The overlay clone lingers through dnd-kit's drop animation; it must
      // never answer to the real card's test id.
      data-testid={overlay ? "task-drag-overlay" : `task-card-${task.id}`}
      className={cn(
        "cursor-grab select-none transition-colors hover:border-foreground/20 active:cursor-grabbing",
        // While its overlay is being dragged, the source card is an empty
        // dashed slot (height kept) — one card moves, one slot waits.
        dragging && "border-dashed bg-muted/40 shadow-none",
        overlay && "shadow-lg",
        selected && !dragging && "border-primary/20 bg-primary/5",
      )}
      onClick={() => {
        if (!overlay) onOpen(task);
      }}
    >
      <CardContent className={cn("p-4", dragging && "invisible")}>
        <div className="flex items-start gap-2">
          {/* The slot is always rendered so titles line up whether or not a task is payable. */}
          {ready ? (
            <Checkbox
              checked={selected}
              aria-label={selected ? "Deselect task for payout" : "Select task for payout"}
              data-testid={`task-select-${task.id}`}
              className="mt-0.5 flex-shrink-0"
              onCheckedChange={(value) => onToggleSelect(task.id, value === true)}
              onClick={stop}
              onPointerDown={stop}
            />
          ) : (
            <span className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            {overlay ? (
              <p className="break-words font-medium leading-snug">{task.title}</p>
            ) : (
              <button
                type="button"
                className="break-words text-left font-medium leading-snug hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(task);
                }}
                onPointerDown={stop}
              >
                {task.title}
              </button>
            )}
            {task.description && (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.description}</p>
            )}
          </div>
          {!overlay && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 flex-shrink-0"
                  data-testid={`task-menu-${task.id}`}
                  onClick={stop}
                  onPointerDown={stop}
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                  <span className="sr-only">More</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={stop}>
                <DropdownMenuItem onSelect={() => onOpen(task)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {COLUMNS.filter((c) => c.status !== task.status).map((column) => (
                  <DropdownMenuItem
                    key={column.status}
                    data-testid={`task-move-${task.id}-${column.status}`}
                    onSelect={() => onMove(task.id, column.status, Number.MAX_SAFE_INTEGER)}
                  >
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Move to {column.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {(task.priority || assignee || due) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {task.priority && (
              <Badge variant="outline" className={PRIORITY_STYLES[task.priority]}>
                {task.priority}
              </Badge>
            )}
            {assignee && <span className="truncate">{assignee}</span>}
            {due && (
              <span className={cn("inline-flex items-center gap-1", overdue && "text-red-600 dark:text-red-400")}>
                <CalendarDays className="h-3 w-3" />
                {due.toLocaleDateString()}
              </span>
            )}
          </div>
        )}

        {totals.length > 0 && (
          <div className="mt-2 text-sm font-medium" data-testid={`task-totals-${task.id}`}>
            {totals.join(" · ")}
          </div>
        )}

        {task.payout.state !== "none" && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <PayoutBadge state={task.payout.state} />
            {task.payout.transactionId && !overlay && (
              <Link
                href={`/wallets/${walletId}/transactions#tx-${task.payout.transactionId}`}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                onClick={stop}
                onPointerDown={stop}
                data-testid={`task-tx-link-${task.id}`}
              >
                {task.payout.state === "paid" ? "View transaction" : "Sign"}
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SortableTaskCard(props: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: { type: "task", status: props.task.status },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <TaskCardBody {...props} dragging={isDragging} />
    </div>
  );
}
