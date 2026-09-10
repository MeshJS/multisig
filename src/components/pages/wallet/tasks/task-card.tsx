import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, CalendarDays, ExternalLink, MoreHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AddressLabeler } from "@/types/token-flow";

import { formatTotals, isPayoutReady, type AssetMetadataLookup } from "./board-model";
import PayoutBadge from "./payout-badge";
import { COLUMNS, columnLabel, type BoardTask, type TaskStatus } from "./types";

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

const PRIORITY_STYLES: Record<string, string> = {
  High: "border-red-500/50 text-red-600 dark:text-red-400",
  Medium: "border-amber-500/50 text-amber-700 dark:text-amber-400",
  Low: "border-muted-foreground/40 text-muted-foreground",
};

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
      data-testid={`task-card-${task.id}`}
      className={cn(
        "cursor-grab select-none p-3 transition-shadow active:cursor-grabbing",
        dragging && "opacity-40",
        overlay && "shadow-lg ring-1 ring-foreground/10",
        selected && "ring-2 ring-primary",
      )}
      onClick={() => {
        if (!overlay) onOpen(task);
      }}
    >
      <div className="flex items-start gap-2">
        {ready && (
          <Checkbox
            checked={selected}
            aria-label={selected ? "Deselect task for payout" : "Select task for payout"}
            data-testid={`task-select-${task.id}`}
            className="mt-0.5"
            onCheckedChange={(value) => onToggleSelect(task.id, value === true)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium leading-snug">{task.title}</p>
          {task.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
          )}
        </div>
        {!overlay && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="-mr-1 -mt-1 h-7 w-7 shrink-0"
                aria-label="Task actions"
                data-testid={`task-menu-${task.id}`}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => onOpen(task)}>Edit</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Move to</DropdownMenuLabel>
              {COLUMNS.filter((c) => c.status !== task.status).map((column) => (
                <DropdownMenuItem
                  key={column.status}
                  data-testid={`task-move-${task.id}-${column.status}`}
                  onSelect={() => onMove(task.id, column.status, Number.MAX_SAFE_INTEGER)}
                >
                  <ArrowRight className="mr-2 h-3.5 w-3.5" />
                  {column.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {(totals.length > 0 || task.priority || assignee || due) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {task.priority && (
            <Badge variant="outline" className={cn("h-5 px-1.5 font-normal", PRIORITY_STYLES[task.priority])}>
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
          {totals.length > 0 && (
            <span className="ml-auto font-medium text-foreground" data-testid={`task-totals-${task.id}`}>
              {totals.join(" · ")}
            </span>
          )}
        </div>
      )}

      {task.payout.state !== "none" && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <PayoutBadge state={task.payout.state} />
          {task.payout.transactionId && !overlay && (
            <Link
              href={`/wallets/${walletId}/transactions#tx-${task.payout.transactionId}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              data-testid={`task-tx-link-${task.id}`}
            >
              {task.payout.state === "paid" ? "View transaction" : "Sign"}
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
      <span className="sr-only">Column: {columnLabel(task.status)}</span>
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
