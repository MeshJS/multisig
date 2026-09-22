import { describe, expect, it, jest } from "@jest/globals";

import { loadPayableTasks } from "@/lib/task-payout/load";

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
      findMany: jest.fn<() => Promise<ReturnType<typeof row>[]>>().mockResolvedValue(rows),
    },
  } as never;
}

describe("loadPayableTasks", () => {
  it("refuses work that has not reached Done", async () => {
    await expect(loadPayableTasks(dbWith([row("t1", "InReview")]), "wallet-1", ["t1"])).rejects.toMatchObject({
      status: 409,
      code: "TASK_NOT_DONE",
      details: { taskIds: ["t1"] },
    });
  });

  it("loads Done tasks in requested order", async () => {
    const tasks = await loadPayableTasks(
      dbWith([row("t2", "Done"), row("t1", "Done")]),
      "wallet-1",
      ["t1", "t2"],
    );
    expect(tasks.map((task) => task.id)).toEqual(["t1", "t2"]);
  });
});
