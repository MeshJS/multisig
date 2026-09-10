import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";

import type { ProposeDeps } from "@/lib/tx-review/propose";
import type { VerifiedDraftToken } from "@/lib/tx-review/draft-token";
import { TxReviewError } from "@/lib/tx-review/context";
import { recipientsHash, TASKS_TXJSON_KEY } from "@/lib/task-payout/spec";
import { withTaskPayoutHooks } from "@/lib/task-payout/hooks";

/**
 * The confirm side of a task payout. Runs inside the pending row's insert
 * transaction: links the tasks only if they still pay exactly what the
 * token was minted for, and is a no-op for tokens without a task origin.
 */

const SUBJECT = "addr_test1qpsubject";
const ALICE = "addr_test1qpalice";

const rows = [
  {
    id: "t1",
    title: "Docs",
    recipients: [{ address: ALICE, unit: "lovelace", quantity: "5000000" }],
    payouts: [] as { status: string }[],
  },
  {
    id: "t2",
    title: "Tests",
    recipients: [{ address: ALICE, unit: "lovelace", quantity: "1000000" }],
    payouts: [] as { status: string }[],
  },
];

const hash = recipientsHash(rows.map((r) => ({ id: r.id, title: r.title, recipients: r.recipients })));

function claims(overrides: Partial<VerifiedDraftToken> = {}): VerifiedDraftToken {
  return {
    jti: "jti-1",
    subject: SUBJECT,
    walletId: "wallet-1",
    clientId: "app",
    spec: { v: 1, walletId: "wallet-1", outputs: [], certificates: [], votes: [], description: "", metadataMessage: "" },
    previewTxHash: "beef",
    origin: { kind: "tasks", taskIds: ["t1", "t2"], recipientsHash: hash },
    expiresAt: 0,
    ...overrides,
  };
}

function makeTx(found = rows) {
  return {
    task: { findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue(found) },
    taskPayout: { createMany: jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: found.length }) },
  } as unknown as Prisma.TransactionClient & {
    task: { findMany: jest.Mock };
    taskPayout: { createMany: jest.Mock };
  };
}

const baseDeps = {
  db: {} as never,
  fetchFreeUtxos: async () => ({ status: 200, body: [] }),
} satisfies ProposeDeps;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("withTaskPayoutHooks", () => {
  it("stamps the tasks namespace next to mcp and links every task inside the insert transaction", async () => {
    const deps = withTaskPayoutHooks(baseDeps);
    const c = claims();

    const extras = deps.txJsonExtras!(c);
    expect(extras[TASKS_TXJSON_KEY]).toMatchObject({
      taskIds: ["t1", "t2"],
      recipientsHash: hash,
      preparedBy: SUBJECT,
    });
    expect(typeof (extras[TASKS_TXJSON_KEY] as { preparedAt: string }).preparedAt).toBe("string");

    const tx = makeTx();
    await deps.afterCreate!(tx, { id: "tx-new" }, c);
    expect(tx.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["t1", "t2"] }, walletId: "wallet-1" } }),
    );
    expect(tx.taskPayout.createMany).toHaveBeenCalledWith({
      data: [
        { walletId: "wallet-1", taskId: "t1", transactionId: "tx-new", status: "Pending", createdBy: SUBJECT },
        { walletId: "wallet-1", taskId: "t2", transactionId: "tx-new", status: "Pending", createdBy: SUBJECT },
      ],
    });
  });

  it("does nothing for a draft that did not come from tasks", async () => {
    const deps = withTaskPayoutHooks(baseDeps);
    const c = claims({ origin: null });
    expect(deps.txJsonExtras!(c)).toEqual({});
    const tx = makeTx();
    await deps.afterCreate!(tx, { id: "tx-new" }, c);
    expect(tx.task.findMany).not.toHaveBeenCalled();
    expect(tx.taskPayout.createMany).not.toHaveBeenCalled();
  });

  it("refuses when a recipient row changed since the preview, creating no link", async () => {
    const deps = withTaskPayoutHooks(baseDeps);
    const edited = rows.map((r) =>
      r.id === "t1" ? { ...r, recipients: [{ ...r.recipients[0]!, quantity: "5000001" }] } : r,
    );
    const tx = makeTx(edited);
    await expect(deps.afterCreate!(tx, { id: "tx-new" }, claims())).rejects.toMatchObject({
      status: 409,
      code: "TASK_CHANGED",
    });
    expect(tx.taskPayout.createMany).not.toHaveBeenCalled();
  });

  it("refuses when a payout for one of the tasks appeared in the meantime", async () => {
    const deps = withTaskPayoutHooks(baseDeps);
    const raced = rows.map((r) => (r.id === "t2" ? { ...r, payouts: [{ status: "Pending" }] } : r));
    const tx = makeTx(raced);
    const error = await deps.afterCreate!(tx, { id: "tx-new" }, claims()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TxReviewError);
    expect(error).toMatchObject({ status: 409, code: "TASK_NOT_PAYABLE" });
    expect(tx.taskPayout.createMany).not.toHaveBeenCalled();
  });

  it("refuses when a task vanished (or moved wallets), as not found", async () => {
    const deps = withTaskPayoutHooks(baseDeps);
    const tx = makeTx([rows[0]!]);
    await expect(deps.afterCreate!(tx, { id: "tx-new" }, claims())).rejects.toMatchObject({
      status: 404,
      code: "TASK_NOT_FOUND",
    });
  });

  it("composes with hooks already on the deps", async () => {
    const innerExtras = jest.fn<() => Record<string, unknown>>().mockReturnValue({ other: 1 });
    const innerAfter = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const deps = withTaskPayoutHooks({ ...baseDeps, txJsonExtras: innerExtras, afterCreate: innerAfter });
    const c = claims();
    expect(deps.txJsonExtras!(c)).toMatchObject({ other: 1, [TASKS_TXJSON_KEY]: expect.anything() });
    await deps.afterCreate!(makeTx(), { id: "tx-new" }, c);
    expect(innerAfter).toHaveBeenCalledTimes(1);
  });
});
