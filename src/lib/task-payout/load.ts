import type { Prisma, PrismaClient } from "@prisma/client";

import { TxReviewError } from "@/lib/tx-review/context";

import type { PayableTask } from "./spec";
import { MAX_PAYOUT_TASKS } from "./state";

type Db = PrismaClient | Prisma.TransactionClient;

export { MAX_PAYOUT_TASKS };

const ACTIVE_LINK = ["Pending", "Paid"] as const;

const include = {
  recipients: { orderBy: { position: "asc" } },
  payouts: { where: { status: { in: [...ACTIVE_LINK] } } },
} satisfies Prisma.TaskInclude;

type Row = Prisma.TaskGetPayload<{ include: typeof include }>;

function toPayable(row: Row): PayableTask {
  return {
    id: row.id,
    title: row.title,
    recipients: row.recipients.map((r) => ({
      address: r.address,
      unit: r.unit,
      quantity: r.quantity,
    })),
  };
}

/**
 * The tasks a payout may cover, in the order requested. Refuses unknown ids,
 * ids belonging to another wallet (same 404 — the caller learns nothing about
 * other wallets' tasks), tasks whose work has not reached Done, and tasks that
 * already have a pending or paid link. A task with no recipients is refused by
 * `buildPayoutSpec`.
 */
export async function loadPayableTasks(
  db: Db,
  walletId: string,
  taskIds: string[],
): Promise<PayableTask[]> {
  const unique = [...new Set(taskIds)];
  const rows = await db.task.findMany({
    where: { id: { in: unique }, walletId },
    include,
  });

  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = unique.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new TxReviewError(
      404,
      "TASK_NOT_FOUND",
      `${missing.length === 1 ? "Task" : "Tasks"} not found in this wallet: ${missing.join(", ")}`,
      { taskIds: missing },
    );
  }

  const incomplete = rows.filter((row) => row.status !== "Done");
  if (incomplete.length > 0) {
    throw new TxReviewError(
      409,
      "TASK_NOT_DONE",
      `${incomplete.length === 1 ? "A task is" : `${incomplete.length} tasks are`} not Done: ${incomplete
        .map((t) => `"${t.title}"`)
        .join(", ")}. Complete and review the work before preparing its payout.`,
      { taskIds: incomplete.map((t) => t.id) },
    );
  }

  const blocked = rows.filter((row) => row.payouts.length > 0);
  if (blocked.length > 0) {
    throw new TxReviewError(
      409,
      "TASK_NOT_PAYABLE",
      `${blocked.length === 1 ? "A task already has" : `${blocked.length} tasks already have`} a payout that is pending or paid: ${blocked
        .map((t) => `"${t.title}"`)
        .join(", ")}. Delete the pending transaction first to pay it again.`,
      { taskIds: blocked.map((t) => t.id) },
    );
  }

  return unique.map((id) => toPayable(byId.get(id)!));
}

/**
 * Every task the wallet could pay right now — Done, with recipients, and no
 * pending or paid link — in board order. This is what "Prepare payout" means
 * when nothing was picked: pay all the finished work. The caller still sees
 * exactly which tasks were included before anything is created.
 */
export async function loadAllPayableTasks(db: Db, walletId: string): Promise<PayableTask[]> {
  const rows = await db.task.findMany({
    where: {
      walletId,
      status: "Done",
      recipients: { some: {} },
      payouts: { none: { status: { in: [...ACTIVE_LINK] } } },
    },
    include,
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  if (rows.length === 0) {
    throw new TxReviewError(
      409,
      "NO_PAYABLE_TASKS",
      "No Done task with recipients is waiting for payment. Move finished work to Done and add its recipients first.",
    );
  }
  if (rows.length > MAX_PAYOUT_TASKS) {
    throw new TxReviewError(
      400,
      "TOO_MANY_TASKS",
      `${rows.length} tasks are payable, but one payout covers at most ${MAX_PAYOUT_TASKS}. Pass the taskIds to pay in this transaction.`,
      { payableCount: rows.length, max: MAX_PAYOUT_TASKS },
    );
  }
  return rows.map(toPayable);
}
