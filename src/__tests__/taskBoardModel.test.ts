import { describe, expect, it } from "@jest/globals";

import {
  applyMove,
  formatTotals,
  groupByColumn,
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
    payout: { state: "none", transactionId: null, txHash: null },
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
