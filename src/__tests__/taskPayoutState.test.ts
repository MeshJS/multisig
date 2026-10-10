import { describe, expect, it } from "@jest/globals";

import { derivePayoutState, PAYOUT_BLOCKER_LABELS, PAYOUT_STATE_LABELS } from "@/lib/task-payout/state";

/**
 * The badge on a task card, and the "can this be paid now?" answer the
 * board, the dialog and the MCP tools share. Derived, never stored, so the
 * precedence lives in one place and the server and the board cannot disagree.
 */
describe("derivePayoutState", () => {
  const one = { length: 1 };
  const none = { length: 0 };

  it("is none without recipients and ready with them", () => {
    expect(derivePayoutState({ status: "Done", recipients: none, payouts: [] })).toEqual({
      state: "none",
      transactionId: null,
      txHash: null,
      payable: false,
      blocker: "no_recipients",
    });
    expect(derivePayoutState({ status: "Done", recipients: one, payouts: [] })).toEqual({
      state: "ready",
      transactionId: null,
      txHash: null,
      payable: true,
      blocker: null,
    });
  });

  it("is ready but not payable until the work reaches Done", () => {
    const configured = derivePayoutState({ status: "InReview", recipients: one, payouts: [] });
    expect(configured.state).toBe("ready");
    expect(configured.payable).toBe(false);
    expect(configured.blocker).toBe("not_done");
  });

  it("is pending while a link awaits signatures, pointing at that transaction", () => {
    expect(
      derivePayoutState({
        status: "Done",
        recipients: one,
        payouts: [{ status: "Pending", transactionId: "tx-1" }],
      }),
    ).toEqual({ state: "pending", transactionId: "tx-1", txHash: null, payable: false, blocker: "pending" });
  });

  it("is paid once any link is paid, even if a stale pending one remains", () => {
    expect(
      derivePayoutState({
        status: "Done",
        recipients: one,
        payouts: [
          { status: "Pending", transactionId: "tx-2" },
          { status: "Paid", transactionId: "tx-1", txHash: "abc" },
        ],
      }),
    ).toEqual({ state: "paid", transactionId: "tx-1", txHash: "abc", payable: false, blocker: "paid" });
  });

  it("ignores cancelled links, so the task is payable again", () => {
    const cancelled = [{ status: "Cancelled" as const, transactionId: "tx-1" }];
    const again = derivePayoutState({ status: "Done", recipients: one, payouts: cancelled });
    expect(again.state).toBe("ready");
    expect(again.payable).toBe(true);
    expect(derivePayoutState({ status: "Done", recipients: none, payouts: cancelled }).state).toBe("none");
  });

  it("ranks blockers: a payment outranks missing recipients, which outrank the column", () => {
    // A paid task in Backlog with no recipients is still "paid", not "not done".
    expect(
      derivePayoutState({
        status: "Backlog",
        recipients: none,
        payouts: [{ status: "Paid", transactionId: "tx-1", txHash: "ab" }],
      }).blocker,
    ).toBe("paid");
    expect(derivePayoutState({ status: "Backlog", recipients: none, payouts: [] }).blocker).toBe("no_recipients");
  });

  it("has a label for every visible state and every blocker", () => {
    expect(PAYOUT_STATE_LABELS.none).toBe("");
    for (const state of ["ready", "pending", "paid"] as const) {
      expect(PAYOUT_STATE_LABELS[state].length).toBeGreaterThan(0);
    }
    for (const blocker of ["paid", "pending", "no_recipients", "not_done"] as const) {
      expect(PAYOUT_BLOCKER_LABELS[blocker].length).toBeGreaterThan(0);
    }
  });
});
