import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

/**
 * The column under the pointer wins. Corner distance alone misfires on a
 * board: a card is nearly as wide as its column, so its corners can sit
 * closer to the neighbouring column's corners than to the one the pointer
 * is in. Corner distance is only the fallback (keyboard drags have no
 * pointer).
 */
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCorners(args);
};
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { groupByColumn, isTaskSettled, reorderColumn, type ColumnOrder } from "./board-model";
import Column from "./column";
import { TaskCardBody, type TaskCardProps } from "./task-card";
import { COLUMNS, type BoardTask, type TaskStatus } from "./types";

/**
 * Four fixed columns with drag-and-drop between and within them. The
 * column order lives in local state while a drag is in progress (so cards
 * follow the pointer across containers); on drop, the parent gets one
 * `onMove(id, status, position)` and the local order re-syncs from props.
 *
 * Below `md` the columns stack into one — the same one-column collapse
 * every other wallet page makes.
 */
export default function TaskBoard({
  tasks,
  selectedIds,
  cardProps,
  onMove,
}: {
  tasks: BoardTask[];
  selectedIds: Set<string>;
  cardProps: Omit<TaskCardProps, "task" | "selected">;
  onMove: (id: string, status: TaskStatus, position: number) => void;
}) {
  const [order, setOrder] = useState<ColumnOrder>(() => groupByColumn(tasks));
  const [activeId, setActiveId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  useEffect(() => {
    if (activeId === null) setOrder(groupByColumn(tasks));
  }, [tasks, activeId]);

  const sensors = useSensors(
    // A small distance so a click still opens the card.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function containerOf(id: string): TaskStatus | null {
    if (COLUMNS.some((c) => c.status === id)) return id as TaskStatus;
    for (const column of COLUMNS) {
      if (order[column.status].includes(id)) return column.status;
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const id = String(active.id);
    const from = containerOf(id);
    const to = containerOf(String(over.id));
    if (!from || !to || from === to) return;
    setOrder((current) => {
      const source = current[from].filter((x) => x !== id);
      const destination = [...current[to]];
      const overIndex = destination.indexOf(String(over.id));
      const insertAt = overIndex >= 0 ? overIndex : destination.length;
      destination.splice(insertAt, 0, id);
      return { ...current, [from]: source, [to]: destination };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const id = String(active.id);
    setActiveId(null);
    if (!over) {
      setOrder(groupByColumn(tasks));
      return;
    }
    const to = containerOf(String(over.id)) ?? containerOf(id);
    if (!to) return;
    const task = byId.get(id);
    if (!task) return;
    if (isTaskSettled(task)) {
      setOrder(groupByColumn(tasks));
      return;
    }
    const overId = String(over.id);
    let next: string[];
    let position: number;

    if (task.status === to) {
      // dnd-kit reports indices from the original list. Removing the active
      // card before looking up `over` makes downward moves land one slot early.
      next = reorderColumn(order[to], id, overId === to ? null : overId);
      position = next.indexOf(id);
    } else {
      // `handleDragOver` already placed cross-column cards. Keep that exact
      // position, especially when collision detection now reports the active
      // card itself after it has rendered in the destination.
      position = order[to].indexOf(id);
      if (position >= 0) {
        next = order[to];
      } else {
        const column = order[to].filter((x) => x !== id);
        const overIndex = column.indexOf(overId);
        position =
          overId === to
            ? column.length
            : overIndex >= 0
              ? overIndex
              : column.length;
        next = [...column];
        next.splice(position, 0, id);
      }
    }
    if (position < 0) return;
    setOrder((current) => ({ ...current, [to]: next }));
    const unchanged =
      task.status === to &&
      groupByColumn(tasks)[to].join(",") === next.join(",");
    if (!unchanged) onMove(id, to, position);
  }

  const activeTask = activeId ? byId.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setOrder(groupByColumn(tasks));
      }}
    >
      <div
        role="region"
        aria-label="Task board"
        className="grid gap-3 md:grid-cols-4 md:gap-4"
        data-testid="task-board"
      >
        {COLUMNS.map((column) => (
          <Column
            key={column.status}
            status={column.status}
            label={column.label}
            tasks={order[column.status].map((id) => byId.get(id)).filter((t): t is BoardTask => !!t)}
            selectedIds={selectedIds}
            cardProps={cardProps}
          />
        ))}
      </div>
      {/*
        Portalled to <body> on purpose. The overlay is position: fixed, and the
        board lives inside a Card whose backdrop-blur makes that card the
        containing block for fixed descendants (and whose overflow-hidden
        clips them) — without the portal the overlay is pinned to the card's
        corner instead of following the pointer.
      */}
      {typeof document !== "undefined" &&
        createPortal(
          <DragOverlay>
            {activeTask ? (
              <TaskCardBody
                {...cardProps}
                task={activeTask}
                selected={selectedIds.has(activeTask.id)}
                overlay
              />
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}
