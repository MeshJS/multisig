import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Keeps TaskPayout links in step with the transaction they point at. Called
 * from every server site that moves a transaction to state 1 or removes a
 * pending one; see the call sites in `src/server/api/routers/transactions.ts`
 * and `src/pages/api/v1/signTransaction.ts`. Both are updateMany on the
 * Pending rows only, so calling them twice is harmless.
 */

export async function markPayoutsPaid(
  db: Db,
  args: { transactionId: string; txHash?: string | null },
): Promise<number> {
  const result = await db.taskPayout.updateMany({
    where: { transactionId: args.transactionId, status: "Pending" },
    data: { status: "Paid", paidAt: new Date(), txHash: args.txHash ?? undefined },
  });
  return result.count;
}

export async function cancelPayoutsForTransaction(
  db: Db,
  transactionId: string,
): Promise<number> {
  const result = await db.taskPayout.updateMany({
    where: { transactionId, status: "Pending" },
    data: { status: "Cancelled" },
  });
  return result.count;
}
