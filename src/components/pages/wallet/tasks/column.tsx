import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

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
    <section
      className="flex min-w-[272px] snap-start flex-col rounded-lg border bg-muted/30 md:min-w-0"
      data-testid={`task-column-${status}`}
      aria-label={label}
    >
      <header className="flex items-center justify-between px-3 py-2">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span
          className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          data-testid={`task-column-count-${status}`}
        >
          {tasks.length}
        </span>
      </header>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "flex min-h-[120px] flex-1 flex-col gap-2 px-2 pb-2 transition-colors",
            isOver && "bg-muted/60",
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
    </section>
  );
}
