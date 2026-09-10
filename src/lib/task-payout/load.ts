import type { Prisma, PrismaClient } from "@prisma/client";

import { TxReviewError } from "@/lib/tx-review/context";

import type { PayableTask } from "./spec";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The tasks a payout may cover, in the order requested. Refuses unknown ids,
 * ids belonging to another wallet (same 404 — the caller learns nothing about
 * other wallets' tasks), and tasks that already have a pending or paid link.
 * A task with no recipients is refused by `buildPayoutSpec`.
 */
export async function loadPayableTasks(
  db: Db,
  walletId: string,
  taskIds: string[],
): Promise<PayableTask[]> {
  const unique = [...new Set(taskIds)];
  const rows = await db.task.findMany({
    where: { id: { in: unique }, walletId },
    include: {
      recipients: { orderBy: { position: "asc" } },
      payouts: { where: { status: { in: ["Pending", "Paid"] } } },
    },
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

  return unique.map((id) => {
    const row = byId.get(id)!;
    return {
      id: row.id,
      title: row.title,
      recipients: row.recipients.map((r) => ({
        address: r.address,
        unit: r.unit,
        quantity: r.quantity,
      })),
    };
  });
}
