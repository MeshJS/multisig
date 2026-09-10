import { describe, expect, it } from "@jest/globals";

import { derivePayoutState, PAYOUT_STATE_LABELS } from "@/lib/task-payout/state";

/**
 * The badge on a task card. Derived, never stored, so the precedence lives
 * in one place and the server and the board cannot disagree.
 */
describe("derivePayoutState", () => {
  const one = { length: 1 };
  const none = { length: 0 };

  it("is none without recipients and ready with them", () => {
    expect(derivePayoutState({ recipients: none, payouts: [] })).toEqual({
      state: "none",
      transactionId: null,
      txHash: null,
    });
    expect(derivePayoutState({ recipients: one, payouts: [] })).toEqual({
      state: "ready",
      transactionId: null,
      txHash: null,
    });
  });

  it("is pending while a link awaits signatures, pointing at that transaction", () => {
    expect(
      derivePayoutState({ recipients: one, payouts: [{ status: "Pending", transactionId: "tx-1" }] }),
    ).toEqual({ state: "pending", transactionId: "tx-1", txHash: null });
  });

  it("is paid once any link is paid, even if a stale pending one remains", () => {
    expect(
      derivePayoutState({
        recipients: one,
        payouts: [
          { status: "Pending", transactionId: "tx-2" },
          { status: "Paid", transactionId: "tx-1", txHash: "abc" },
        ],
      }),
    ).toEqual({ state: "paid", transactionId: "tx-1", txHash: "abc" });
  });

  it("ignores cancelled links, so the task is payable again", () => {
    expect(
      derivePayoutState({ recipients: one, payouts: [{ status: "Cancelled", transactionId: "tx-1" }] }).state,
    ).toBe("ready");
    expect(
      derivePayoutState({ recipients: none, payouts: [{ status: "Cancelled", transactionId: "tx-1" }] }).state,
    ).toBe("none");
  });

  it("has a label for every visible state and none for the empty one", () => {
    expect(PAYOUT_STATE_LABELS.none).toBe("");
    for (const state of ["ready", "pending", "paid"] as const) {
      expect(PAYOUT_STATE_LABELS[state].length).toBeGreaterThan(0);
    }
  });
});
