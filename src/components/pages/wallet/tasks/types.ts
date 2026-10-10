import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/server/api/root";

type RouterOutputs = inferRouterOutputs<AppRouter>;

/** One task as `task.list` returns it: recipients, active payout links, derived payout state. */
export type BoardTask = RouterOutputs["task"]["list"][number];
export type TaskStatus = BoardTask["status"];
export type TaskPriority = NonNullable<BoardTask["priority"]>;
export type PayoutPreview = RouterOutputs["task"]["preparePayout"];
export type PayoutConfirmation = RouterOutputs["task"]["confirmPayout"];

export const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "Backlog", label: "Backlog" },
  { status: "InProgress", label: "In progress" },
  { status: "InReview", label: "In review" },
  { status: "Done", label: "Done" },
];

export const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
];

export function columnLabel(status: TaskStatus): string {
  return COLUMNS.find((c) => c.status === status)?.label ?? status;
}
