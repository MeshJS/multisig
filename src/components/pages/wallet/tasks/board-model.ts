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

export function isPayoutReady(task: BoardTask): boolean {
  return task.payout.state === "ready";
}
