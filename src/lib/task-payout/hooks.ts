import type { ProposeDeps } from "@/lib/tx-review/propose";
import { TxReviewError } from "@/lib/tx-review/context";

import { loadPayableTasks } from "./load";
import { recipientsHash, TASKS_TXJSON_KEY, type TasksTxJsonProvenance } from "./spec";

/**
 * The confirm side of a task payout, attached to `runTransactionPropose`
 * through its deps — so the web app's `task.confirmPayout` and the MCP
 * `transaction_propose` tool link tasks the same way, and a token with no
 * task origin is proposed exactly as before.
 *
 * Inside the insert's database transaction the tasks are re-read and their
 * recipient rows re-hashed: if anything the human reviewed has changed since
 * the preview, or a payout was created for one of the tasks in between, the
 * insert is rolled back and the caller gets a 409 telling them to preview
 * again.
 */
export function withTaskPayoutHooks(deps: ProposeDeps): ProposeDeps {
  return {
    ...deps,
    txJsonExtras: (claims) => {
      const base = deps.txJsonExtras?.(claims) ?? {};
      if (claims.origin?.kind !== "tasks") return base;
      const provenance: TasksTxJsonProvenance = {
        taskIds: claims.origin.taskIds,
        recipientsHash: claims.origin.recipientsHash,
        preparedBy: claims.subject,
        preparedAt: new Date().toISOString(),
      };
      return { ...base, [TASKS_TXJSON_KEY]: provenance };
    },
    afterCreate: async (tx, created, claims) => {
      await deps.afterCreate?.(tx, created, claims);
      if (claims.origin?.kind !== "tasks") return;
      const { taskIds } = claims.origin;

      // Throws TASK_NOT_FOUND / TASK_NOT_PAYABLE (a payout appeared since the preview).
      const tasks = await loadPayableTasks(tx, claims.walletId, taskIds);
      if (recipientsHash(tasks) !== claims.origin.recipientsHash) {
        throw new TxReviewError(
          409,
          "TASK_CHANGED",
          "A task's recipients or amounts changed since the payout was previewed. Nothing was created — preview the payout again.",
          { taskIds },
        );
      }

      await tx.taskPayout.createMany({
        data: taskIds.map((taskId) => ({
          walletId: claims.walletId,
          taskId,
          transactionId: created.id,
          status: "Pending" as const,
          createdBy: claims.subject,
        })),
      });
    },
  };
}
