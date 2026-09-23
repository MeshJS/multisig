import { describe, expect, it } from "@jest/globals";

import {
  applyMove,
  filterPaidTasks,
  formatTotals,
  groupByColumn,
  isPayoutReady,
  isTaskSettled,
  reorderColumn,
} from "@/components/pages/wallet/tasks/board-model";
import type { BoardTask } from "@/components/pages/wallet/tasks/types";

/**
 * The board's optimistic move must produce the same dense positions the
 * server writes, or the cards jump when the real list arrives.
 */

function task(id: string, status: BoardTask["status"], position: number): BoardTask {
  return {
    id,
    walletId: "w",
    title: id,
    description: null,
    status,
    priority: null,
    assigneeAddress: null,
    dueDate: null,
    position,
    createdBy: "addr",
    createdAt: new Date(2026, 0, 1, 0, 0, position),
    updatedAt: new Date(),
    recipients: [],
    payouts: [],
    payout: { state: "none", transactionId: null, txHash: null, payable: false, blocker: "no_recipients" },
  };
}

const tasks = [
  task("a", "Backlog", 0),
  task("b", "Backlog", 1),
  task("c", "Backlog", 2),
  task("d", "InProgress", 0),
];

describe("groupByColumn", () => {
  it("orders ids by position within each of the four columns", () => {
    expect(groupByColumn(tasks)).toEqual({
      Backlog: ["a", "b", "c"],
      InProgress: ["d"],
      InReview: [],
      Done: [],
    });
  });
});

describe("reorderColumn", () => {
  it("moves a card downward using indices from the original list", () => {
    expect(reorderColumn(["a", "b", "c"], "a", "b")).toEqual(["b", "a", "c"]);
  });

  it("moves a card upward", () => {
    expect(reorderColumn(["a", "b", "c"], "c", "b")).toEqual(["a", "c", "b"]);
  });

  it("moves a card to the end when the column itself is the drop target", () => {
    expect(reorderColumn(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
  });

  it("returns the same list when the drop does not change its position", () => {
    const ids = ["a", "b", "c"];
    expect(reorderColumn(ids, "b", "b")).toBe(ids);
  });
});

describe("applyMove", () => {
  it("moves across columns and renumbers both densely", () => {
    const next = applyMove(tasks, "b", "InProgress", 0);
    expect(groupByColumn(next)).toMatchObject({ Backlog: ["a", "c"], InProgress: ["b", "d"] });
    const byId = new Map(next.map((t) => [t.id, t]));
    expect([byId.get("a")!.position, byId.get("c")!.position]).toEqual([0, 1]);
    expect([byId.get("b")!.position, byId.get("d")!.position]).toEqual([0, 1]);
    expect(byId.get("b")!.status).toBe("InProgress");
  });

  it("reorders within a column", () => {
    const next = applyMove(tasks, "c", "Backlog", 0);
    expect(groupByColumn(next).Backlog).toEqual(["c", "a", "b"]);
  });

  it("clamps an out-of-range position to the end", () => {
    const next = applyMove(tasks, "a", "InProgress", 99);
    expect(groupByColumn(next).InProgress).toEqual(["d", "a"]);
  });

  it("leaves the list untouched for an unknown id", () => {
    expect(applyMove(tasks, "zzz", "Done", 0)).toBe(tasks);
  });
});

describe("formatTotals", () => {
  it("sums per unit, ADA first, using registry decimals and names", () => {
    const unit = "b".repeat(56) + "aa";
    const totals = formatTotals(
      [
        { unit, quantity: "1500" },
        { unit: "lovelace", quantity: "2500000" },
        { unit: "lovelace", quantity: "500000" },
        { unit, quantity: "500" },
      ],
      { [unit]: { assetName: "HOSKY", decimals: 2 } },
    );
    expect(totals).toEqual(["3 ADA", "20 HOSKY"]);
  });

  it("falls back to a truncated unit for unknown tokens and skips bad quantities", () => {
    const unit = "c".repeat(56) + "dd";
    expect(formatTotals([{ unit, quantity: "7" }, { unit, quantity: "x" }], {})).toEqual([
      `7 ${unit.slice(0, 6)}…${unit.slice(-4)}`,
    ]);
  });
});

describe("payout board state", () => {
  it("only makes completed work selectable for payout", () => {
    // The server decides; the board reads its answer rather than re-deriving it.
    const configured = {
      ...task("pay", "InReview", 0),
      payout: { state: "ready" as const, transactionId: null, txHash: null, payable: false, blocker: "not_done" as const },
    };
    expect(isPayoutReady(configured)).toBe(false);
    expect(
      isPayoutReady({ payout: { ...configured.payout, payable: true, blocker: null } }),
    ).toBe(true);
  });

  it("hides paid history by default without removing it", () => {
    const active = task("active", "Done", 0);
    const paid = {
      ...task("paid", "Done", 1),
      payout: { state: "paid" as const, transactionId: "tx-1", txHash: "ab", payable: false, blocker: "paid" as const },
    };
    expect(filterPaidTasks([active, paid], false)).toEqual([active]);
    expect(filterPaidTasks([active, paid], true)).toEqual([active, paid]);
  });

  it("locks pending and paid tasks, but not configured or cancelled ones", () => {
    const base = task("task", "Done", 0);
    expect(isTaskSettled(base)).toBe(false);
    expect(
      isTaskSettled({ ...base, payout: { state: "ready", transactionId: null, txHash: null, payable: true, blocker: null } }),
    ).toBe(false);
    expect(
      isTaskSettled({ ...base, payout: { state: "pending", transactionId: "tx-1", txHash: null, payable: false, blocker: "pending" } }),
    ).toBe(true);
    expect(
      isTaskSettled({ ...base, payout: { state: "paid", transactionId: "tx-1", txHash: "ab", payable: false, blocker: "paid" } }),
    ).toBe(true);
  });
});
