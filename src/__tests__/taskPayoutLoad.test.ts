import { describe, expect, it, jest } from "@jest/globals";

import { loadAllPayableTasks, loadPayableTasks, MAX_PAYOUT_TASKS } from "@/lib/task-payout/load";

const ALICE = "addr_test1qpalice";

function row(id: string, status: "Backlog" | "InReview" | "Done") {
  return {
    id,
    title: `Task ${id}`,
    status,
    recipients: [{ address: ALICE, unit: "lovelace", quantity: "1000000" }],
    payouts: [],
  };
}

function dbWith(rows: ReturnType<typeof row>[]) {
  return {
    task: {
      findMany: jest.fn<(args: unknown) => Promise<ReturnType<typeof row>[]>>().mockResolvedValue(rows),
    },
  };
}

describe("loadPayableTasks", () => {
  it("refuses work that has not reached Done", async () => {
    await expect(
      loadPayableTasks(dbWith([row("t1", "InReview")]) as never, "wallet-1", ["t1"]),
    ).rejects.toMatchObject({
      status: 409,
      code: "TASK_NOT_DONE",
      details: { taskIds: ["t1"] },
    });
  });

  it("loads Done tasks in requested order", async () => {
    const tasks = await loadPayableTasks(
      dbWith([row("t2", "Done"), row("t1", "Done")]) as never,
      "wallet-1",
      ["t1", "t2"],
    );
    expect(tasks.map((task) => task.id)).toEqual(["t1", "t2"]);
  });
});

describe("loadAllPayableTasks", () => {
  // "Prepare payout" with nothing picked means every payable task. The query
  // itself filters on Done + recipients + no active link, so the loader only
  // has to bound the result and refuse an empty one.
  it("returns the wallet's payable tasks in board order", async () => {
    const db = dbWith([row("t1", "Done"), row("t2", "Done")]);
    const tasks = await loadAllPayableTasks(db as never, "wallet-1");
    expect(tasks.map((task) => task.id)).toEqual(["t1", "t2"]);
    expect(db.task.findMany.mock.calls[0]![0]).toMatchObject({
      where: { walletId: "wallet-1", status: "Done", recipients: { some: {} } },
    });
  });

  it("refuses when nothing is payable", async () => {
    await expect(loadAllPayableTasks(dbWith([]) as never, "wallet-1")).rejects.toMatchObject({
      status: 409,
      code: "NO_PAYABLE_TASKS",
    });
  });

  it("asks for explicit ids beyond the per-payout cap", async () => {
    const rows = Array.from({ length: MAX_PAYOUT_TASKS + 1 }, (_, i) => row(`t${i}`, "Done"));
    await expect(loadAllPayableTasks(dbWith(rows) as never, "wallet-1")).rejects.toMatchObject({
      status: 400,
      code: "TOO_MANY_TASKS",
      details: { payableCount: MAX_PAYOUT_TASKS + 1, max: MAX_PAYOUT_TASKS },
    });
  });
});
