import type { McpToolResult, ToolContext } from "@/lib/mcp/tools";
import { loadReviewWalletContext, TxReviewError } from "@/lib/tx-review/context";
import type { ReviewDeps } from "@/lib/tx-review/pipeline";
import { runSpecPreview } from "@/lib/tx-review/preview";

import { loadPayableTasks } from "./load";
import { buildPayoutSpec, recipientsHash } from "./spec";

export type TaskPayoutPreviewInput = {
  walletId: string;
  taskIds: string[];
};

/**
 * Preview a payout for one or more tasks: the wallet is authorized first (a
 * non-signer must not learn whether a task id exists), the tasks are loaded
 * and turned into a canonical spec, and the shared preview pipeline builds,
 * summarizes and mints the draft token — with the task ids and a hash of
 * their recipient rows bound in, so `transaction_propose` / `confirmPayout`
 * link exactly the tasks whose amounts were on the card.
 *
 * Persists nothing.
 */
export async function prepareTaskPayoutPreview(
  input: TaskPayoutPreviewInput,
  ctx: ToolContext,
  deps: ReviewDeps,
): Promise<McpToolResult> {
  try {
    const wallet = await loadReviewWalletContext(deps.db, input.walletId, ctx.caller);
    const tasks = await loadPayableTasks(deps.db, wallet.walletRow.id, input.taskIds);
    const spec = buildPayoutSpec(wallet.walletRow.id, tasks);
    const result = await runSpecPreview(spec, ctx, deps, {
      wallet,
      draftId: "task-payout",
      origin: {
        kind: "tasks",
        taskIds: tasks.map((t) => t.id),
        recipientsHash: recipientsHash(tasks),
      },
      extraBody: {
        tasks: tasks.map((t) => ({ id: t.id, title: t.title })),
      },
    });
    return {
      ...result,
      audit: { ...(result.audit ?? {}), taskCount: tasks.length },
    };
  } catch (error) {
    if (error instanceof TxReviewError) return error.toResult();
    throw error;
  }
}
