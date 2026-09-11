import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import SortableTaskCard, { type TaskCardProps } from "./task-card";
import type { BoardTask, TaskStatus } from "./types";

export default function Column({
  status,
  label,
  tasks,
  selectedIds,
  cardProps,
}: {
  status: TaskStatus;
  label: string;
  tasks: BoardTask[];
  selectedIds: Set<string>;
  cardProps: Omit<TaskCardProps, "task" | "selected">;
}) {
  // The column itself is a drop target so an empty column accepts a card.
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { type: "column", status } });
  return (
    <div
      className="flex flex-col rounded-lg border border-border/50 bg-muted/30"
      data-testid={`task-column-${status}`}
    >
      <div className="flex items-center justify-between p-3 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </h3>
        <Badge variant="secondary" data-testid={`task-column-count-${status}`}>
          {tasks.length}
        </Badge>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "flex min-h-[120px] flex-1 flex-col gap-2 px-2 pb-2 transition-colors",
            isOver && "bg-muted/50",
          )}
        >
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              selected={selectedIds.has(task.id)}
              {...cardProps}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
