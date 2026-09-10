/**
 * Payout state of a task, derived — never stored. The board shows it as a
 * badge; the column is the task's own status and is never moved by a payment.
 *
 * Precedence: a Paid link wins over a Pending one, a Pending link over
 * "ready", and a task with no recipients has nothing to pay. Cancelled links
 * (the pending transaction was deleted or replaced) are ignored, so the task
 * becomes payable again.
 */

export type TaskPayoutState = "none" | "ready" | "pending" | "paid";

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
};

export function derivePayoutState(task: {
  recipients: { length: number };
  payouts: PayoutLinkLike[];
}): DerivedPayoutState {
  const paid = task.payouts.find((p) => p.status === "Paid");
  if (paid) {
    return { state: "paid", transactionId: paid.transactionId, txHash: paid.txHash ?? null };
  }
  const pending = task.payouts.find((p) => p.status === "Pending");
  if (pending) {
    return { state: "pending", transactionId: pending.transactionId, txHash: null };
  }
  if (task.recipients.length > 0) {
    return { state: "ready", transactionId: null, txHash: null };
  }
  return { state: "none", transactionId: null, txHash: null };
}

export const PAYOUT_STATE_LABELS: Record<TaskPayoutState, string> = {
  none: "",
  ready: "Payout ready",
  pending: "Awaiting signatures",
  paid: "Paid",
};
