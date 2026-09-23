import { baseToDisplay } from "@/lib/tx-draft/decimal";

import { COLUMNS, type BoardTask, type TaskStatus } from "./types";

/**
 * Pure helpers behind the board: grouping tasks into columns, applying a
 * move locally (the optimistic update mirrors the server's dense
 * renumbering), and formatting recipient totals.
 */

export type ColumnOrder = Record<TaskStatus, string[]>;

export function groupByColumn(tasks: BoardTask[]): ColumnOrder {
  const order: ColumnOrder = { Backlog: [], InProgress: [], InReview: [], Done: [] };
  for (const task of [...tasks].sort(byPosition)) {
    order[task.status].push(task.id);
  }
  return order;
}

/**
 * Apply dnd-kit's active/over indices to one column. The target index must
 * come from the original list: removing the active id first shifts every
 * later target up by one and turns a one-place downward move into a no-op.
 * A null `overId` means the column itself was hit, so move to the end.
 */
export function reorderColumn(
  ids: string[],
  activeId: string,
  overId: string | null,
): string[] {
  const activeIndex = ids.indexOf(activeId);
  const overIndex = overId === null ? ids.length - 1 : ids.indexOf(overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return ids;
  const next = [...ids];
  next.splice(activeIndex, 1);
  next.splice(overIndex, 0, activeId);
  return next;
}

function byPosition(a: BoardTask, b: BoardTask) {
  return a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Place `id` at `position` within `status` and renumber both affected
 * columns densely — what `task.move` does server-side, so the cache the
 * user sees while the request is in flight matches what comes back.
 */
export function applyMove(
  tasks: BoardTask[],
  id: string,
  status: TaskStatus,
  position: number,
): BoardTask[] {
  const moving = tasks.find((t) => t.id === id);
  if (!moving) return tasks;
  const destination = tasks
    .filter((t) => t.status === status && t.id !== id)
    .sort(byPosition)
    .map((t) => t.id);
  destination.splice(Math.min(position, destination.length), 0, id);
  const source =
    moving.status === status
      ? []
      : tasks
          .filter((t) => t.status === moving.status && t.id !== id)
          .sort(byPosition)
          .map((t) => t.id);
  const nextPosition = new Map<string, { status: TaskStatus; position: number }>();
  destination.forEach((taskId, index) => nextPosition.set(taskId, { status, position: index }));
  source.forEach((taskId, index) =>
    nextPosition.set(taskId, { status: moving.status, position: index }),
  );
  return tasks.map((t) => {
    const next = nextPosition.get(t.id);
    return next ? { ...t, ...next } : t;
  });
}

export type AssetMetadataLookup = Record<string, { assetName?: string; decimals?: number } | undefined>;

/** Per-unit totals across recipients, formatted for a card ("12.5 ADA", "100 HOSKY"). */
export function formatTotals(
  recipients: { unit: string; quantity: string }[],
  metadata: AssetMetadataLookup,
): string[] {
  const sums = new Map<string, bigint>();
  for (const r of recipients) {
    let q: bigint;
    try {
      q = BigInt(r.quantity);
    } catch {
      continue;
    }
    sums.set(r.unit, (sums.get(r.unit) ?? 0n) + q);
  }
  const entries = [...sums.entries()].sort(([a], [b]) =>
    a === "lovelace" ? -1 : b === "lovelace" ? 1 : a.localeCompare(b),
  );
  return entries.map(([unit, total]) => formatAmount(unit, total.toString(), metadata));
}

export function formatAmount(unit: string, quantity: string, metadata: AssetMetadataLookup): string {
  if (unit === "lovelace") return `${baseToDisplay(quantity, 6)} ADA`;
  const meta = metadata[unit];
  const name = meta?.assetName || `${unit.slice(0, 6)}…${unit.slice(-4)}`;
  return `${baseToDisplay(quantity, meta?.decimals ?? 0)} ${name}`;
}

export function unitDecimals(unit: string, metadata: AssetMetadataLookup): number {
  return unit === "lovelace" ? 6 : (metadata[unit]?.decimals ?? 0);
}

/** Can this task go into a payout right now? Decided by the server, in one place. */
export function isPayoutReady(task: Pick<BoardTask, "payout">): boolean {
  return task.payout.payable;
}

/** Pending and paid tasks are immutable records of an in-flight or completed payout. */
export function isTaskSettled(task: Pick<BoardTask, "payout">): boolean {
  return task.payout.state === "pending" || task.payout.state === "paid";
}

/** Paid tasks are history: keep them in the data set, but hide them from the active board by default. */
export function filterPaidTasks(tasks: BoardTask[], showPaid: boolean): BoardTask[] {
  return showPaid ? tasks : tasks.filter((task) => task.payout.state !== "paid");
}
