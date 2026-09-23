/**
 * Payout state of a task, derived — never stored. The board shows it as a
 * badge; the column is the task's own status and is never moved by a payment.
 *
 * Precedence: a Paid link wins over a Pending one, a Pending link over
 * "ready", and a task with no recipients has nothing to pay. Cancelled links
 * (the pending transaction was deleted or replaced) are ignored, so the task
 * becomes payable again.
 *
 * "Payable" is the one question the board, the payout dialog and the MCP
 * tools all ask — can this task be paid right now? — so it is answered here,
 * once, together with the reason when the answer is no.
 */

export type TaskPayoutState = "none" | "ready" | "pending" | "paid";

/**
 * Upper bound on tasks in one payout; the router, the loader and the MCP
 * schema quote it. It lives here, in a module with no imports, because the
 * router must not pull the payout pipeline (and Mesh) into its graph.
 */
export const MAX_PAYOUT_TASKS = 20;

/** Why a task cannot be paid right now; `null` on a payable task. */
export type PayoutBlocker = "paid" | "pending" | "no_recipients" | "not_done";

export type PayoutLinkLike = {
  status: "Pending" | "Paid" | "Cancelled";
  transactionId: string;
  txHash?: string | null;
};

export type DerivedPayoutState = {
  state: TaskPayoutState;
  /** The transaction the state points at, when there is one. */
  transactionId: string | null;
  txHash: string | null;
  /** True when the task can go into a payout right now (Done, has recipients, no active link). */
  payable: boolean;
  blocker: PayoutBlocker | null;
};

export function derivePayoutState(task: {
  status: string;
  recipients: { length: number };
  payouts: PayoutLinkLike[];
}): DerivedPayoutState {
  const paid = task.payouts.find((p) => p.status === "Paid");
  if (paid) {
    return {
      state: "paid",
      transactionId: paid.transactionId,
      txHash: paid.txHash ?? null,
      payable: false,
      blocker: "paid",
    };
  }
  const pending = task.payouts.find((p) => p.status === "Pending");
  if (pending) {
    return {
      state: "pending",
      transactionId: pending.transactionId,
      txHash: null,
      payable: false,
      blocker: "pending",
    };
  }
  if (task.recipients.length === 0) {
    return { state: "none", transactionId: null, txHash: null, payable: false, blocker: "no_recipients" };
  }
  if (task.status !== "Done") {
    return { state: "ready", transactionId: null, txHash: null, payable: false, blocker: "not_done" };
  }
  return { state: "ready", transactionId: null, txHash: null, payable: true, blocker: null };
}

export const PAYOUT_STATE_LABELS: Record<TaskPayoutState, string> = {
  none: "",
  ready: "Payout ready",
  pending: "Awaiting signatures",
  paid: "Paid",
};

/** One sentence per blocker, for tooltips and tool results. */
export const PAYOUT_BLOCKER_LABELS: Record<PayoutBlocker, string> = {
  paid: "This task has already been paid.",
  pending: "A payout for this task is awaiting signatures.",
  no_recipients: "Add payment recipients to this task first.",
  not_done: "Move it to Done to pay it.",
};
