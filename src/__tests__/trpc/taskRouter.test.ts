import { afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";

import { realTestAddresses } from "../testUtils";
import { cleanupFixtures, seedWallet } from "./fixtures";
import { makeWalletCtx } from "./helpers";

/**
 * The task router against a real Postgres: CRUD and authorization, the
 * dense renumbering behind drag-and-drop, the locks a pending payout puts
 * on a task, and the payout procedures' wiring into the shared pipeline
 * (the pipeline itself is stubbed — it reads chain state).
 */

jest.mock("superjson", () => ({
  __esModule: true,
  default: {
    serialize: (value: unknown) => value,
    deserialize: (value: unknown) => value,
  },
}));

jest.mock("@/server/auth", () => ({
  __esModule: true,
  getServerAuthSession: jest.fn(),
}));

const prepareTaskPayoutPreviewMock = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock("@/lib/task-payout/preview", () => ({
  __esModule: true,
  prepareTaskPayoutPreview: prepareTaskPayoutPreviewMock,
}));

const runTransactionProposeMock = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock("@/lib/tx-review/propose", () => {
  const actual = jest.requireActual("@/lib/tx-review/propose") as object;
  return { __esModule: true, ...actual, runTransactionPropose: runTransactionProposeMock };
});

const HAVE_DB = !!process.env.DATABASE_URL;
const describeWithDb = HAVE_DB ? describe : describe.skip;

let createCaller: typeof import("@/server/api/root").createCaller;
let db: typeof import("@/server/db").db;
let mintDraftToken: typeof import("@/lib/tx-review/draft-token").mintDraftToken;
let walletId: string | undefined;

const SIGNER = realTestAddresses.address1;
const OTHER_SIGNER = realTestAddresses.address2;
// Membership is a string comparison against the wallet's signer list, so any
// distinct address will do for the outsider.
const STRANGER = "addr_test1qpstrangerstrangerstrangerstrangerstrangerstrangerstranger";
const RECIPIENT = realTestAddresses.address2;

describeWithDb("task router", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
    ({ db } = await import("@/server/db"));
    ({ mintDraftToken } = await import("@/lib/tx-review/draft-token"));
  });

  afterEach(async () => {
    jest.clearAllMocks();
    if (walletId) {
      await cleanupFixtures(db, { walletId });
      walletId = undefined;
    }
  });

  async function seed(extraSigners: string[] = [OTHER_SIGNER]) {
    ({ walletId } = await seedWallet(db, SIGNER, extraSigners));
    return {
      signer: createCaller(makeWalletCtx(SIGNER, db) as any),
      other: createCaller(makeWalletCtx(OTHER_SIGNER, db) as any),
      stranger: createCaller(makeWalletCtx(STRANGER, db) as any),
    };
  }

  const recipient = (quantity = "5000000") => ({ address: RECIPIENT, unit: "lovelace", quantity });

  it("creates a task with recipients and lists it with its derived payout state", async () => {
    const { signer } = await seed();
    const created = await signer.task.create({
      walletId: walletId!,
      title: "  Write the docs  ",
      description: "Section 3",
      priority: "High",
      assigneeAddress: OTHER_SIGNER,
      dueDate: new Date("2026-10-01T00:00:00Z"),
      recipients: [recipient(), { address: RECIPIENT, unit: "A".repeat(56), quantity: "10" }],
    });
    expect(created).toMatchObject({
      title: "Write the docs",
      status: "Backlog",
      position: 0,
      createdBy: SIGNER,
      payout: { state: "ready", transactionId: null },
    });
    expect(created.recipients.map((r) => r.unit)).toEqual(["lovelace", "a".repeat(56)]);

    const listed = await signer.task.list({ walletId: walletId! });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(created.id);

    const empty = await signer.task.create({ walletId: walletId!, title: "No pay" });
    expect(empty.payout.state).toBe("none");
    expect(empty.position).toBe(1);
  });

  it("rejects a bad recipient and an empty title", async () => {
    const { signer } = await seed();
    await expect(
      signer.task.create({ walletId: walletId!, title: "x", recipients: [{ ...recipient(), quantity: "0" }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      signer.task.create({ walletId: walletId!, title: "x", recipients: [{ ...recipient(), quantity: "1.5" }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      signer.task.create({ walletId: walletId!, title: "x", recipients: [{ ...recipient(), address: "nope" }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(signer.task.create({ walletId: walletId!, title: "   " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("refuses every procedure to a non-signer, and lets any signer edit", async () => {
    const { signer, other, stranger } = await seed();
    const task = await signer.task.create({ walletId: walletId!, title: "Shared" });

    await expect(stranger.task.list({ walletId: walletId! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(stranger.task.create({ walletId: walletId!, title: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(stranger.task.update({ id: task.id, title: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(stranger.task.move({ id: task.id, status: "Done", position: 0 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(stranger.task.delete({ id: task.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      stranger.task.preparePayout({ walletId: walletId!, taskIds: [task.id] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const edited = await other.task.update({ id: task.id, title: "Shared, edited", recipients: [recipient()] });
    expect(edited.title).toBe("Shared, edited");
    expect(edited.payout.state).toBe("ready");
    await expect(signer.task.update({ id: "missing", title: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("moves across columns and keeps both columns densely numbered", async () => {
    const { signer } = await seed();
    const a = await signer.task.create({ walletId: walletId!, title: "a" });
    const b = await signer.task.create({ walletId: walletId!, title: "b" });
    const c = await signer.task.create({ walletId: walletId!, title: "c" });
    const d = await signer.task.create({ walletId: walletId!, title: "d", status: "InProgress" });

    const moved = await signer.task.move({ id: b.id, status: "InProgress", position: 0 });
    expect(moved).toMatchObject({ status: "InProgress", position: 0 });

    const byId = new Map((await signer.task.list({ walletId: walletId! })).map((t) => [t.id, t]));
    expect([byId.get(a.id)!.position, byId.get(c.id)!.position]).toEqual([0, 1]);
    expect([byId.get(b.id)!.position, byId.get(d.id)!.position]).toEqual([0, 1]);

    // Within a column, to the end, with an out-of-range index.
    await signer.task.move({ id: a.id, status: "Backlog", position: 99 });
    const again = new Map((await signer.task.list({ walletId: walletId! })).map((t) => [t.id, t]));
    expect([again.get(c.id)!.position, again.get(a.id)!.position]).toEqual([0, 1]);
  });

  it("locks recipients and deletion while a payout is awaiting signatures, and frees them when it is cancelled", async () => {
    const { signer } = await seed();
    const task = await signer.task.create({ walletId: walletId!, title: "Paid", recipients: [recipient()] });
    const tx = await db.transaction.create({
      data: {
        walletId: walletId!,
        txJson: JSON.stringify({ tasks: { taskIds: [task.id] } }),
        txCbor: "84a4",
        signedAddresses: [],
        rejectedAddresses: [],
        state: 0,
      },
    });
    await db.taskPayout.create({
      data: { walletId: walletId!, taskId: task.id, transactionId: tx.id, createdBy: SIGNER },
    });

    const listed = await signer.task.list({ walletId: walletId! });
    expect(listed[0]!.payout).toEqual({ state: "pending", transactionId: tx.id, txHash: null });

    // Title edits are fine; recipients and deletion are not.
    await signer.task.update({ id: task.id, title: "Paid (renamed)" });
    await expect(signer.task.update({ id: task.id, recipients: [] })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(signer.task.delete({ id: task.id })).rejects.toMatchObject({ code: "CONFLICT" });

    // Deleting the pending transaction cancels the link.
    await signer.transaction.deleteTransaction({ transactionId: tx.id });
    const freed = await signer.task.list({ walletId: walletId! });
    expect(freed[0]!.payout.state).toBe("ready");
    await signer.task.update({ id: task.id, recipients: [] });
    await signer.task.delete({ id: task.id });
    expect(await signer.task.list({ walletId: walletId! })).toHaveLength(0);
  });

  it("marks the link paid when the transaction is submitted", async () => {
    const { signer } = await seed();
    const task = await signer.task.create({ walletId: walletId!, title: "Paid", recipients: [recipient()] });
    const tx = await db.transaction.create({
      data: { walletId: walletId!, txJson: "{}", txCbor: "84a4", signedAddresses: [], rejectedAddresses: [], state: 0 },
    });
    await db.taskPayout.create({
      data: { walletId: walletId!, taskId: task.id, transactionId: tx.id, createdBy: SIGNER },
    });

    await signer.transaction.updateTransaction({
      transactionId: tx.id,
      signedAddresses: [SIGNER],
      rejectedAddresses: [],
      txCbor: "84a4",
      state: 1,
      txHash: "ab".repeat(32),
    });

    const listed = await signer.task.list({ walletId: walletId! });
    expect(listed[0]!.payout).toEqual({ state: "paid", transactionId: tx.id, txHash: "ab".repeat(32) });
    // Paid tasks stay where they are on the board.
    expect(listed[0]!.status).toBe("Backlog");
    // Deletion of the submitted transaction no longer touches a Paid link.
    await signer.transaction.deleteTransaction({ transactionId: tx.id });
    expect((await signer.task.list({ walletId: walletId! }))[0]!.payout.state).toBe("paid");
  });

  it("prepares a payout through the shared pipeline as the app client and maps its errors", async () => {
    const { signer } = await seed();
    const task = await signer.task.create({ walletId: walletId!, title: "Pay me", recipients: [recipient()] });
    const summary = { kind: "preview", recipients: [], warnings: [] };
    prepareTaskPayoutPreviewMock.mockResolvedValue({
      status: 200,
      body: {
        draftToken: "token",
        expiresAt: "2026-09-10T12:15:00.000Z",
        expiresInSeconds: 900,
        txHash: "beef",
        fee: "170000",
        summary,
        warnings: ["w"],
        tasks: [{ id: task.id, title: "Pay me" }],
      },
      text: "summary text",
      audit: { walletId: walletId!, previewTxHash: "beef" },
    });

    const result = await signer.task.preparePayout({ walletId: walletId!, taskIds: [task.id] });
    expect(result).toMatchObject({ draftToken: "token", txHash: "beef", fee: "170000", warnings: ["w"], text: "summary text" });
    expect(result.tasks).toEqual([{ id: task.id, title: "Pay me" }]);

    const [input, toolCtx, deps] = prepareTaskPayoutPreviewMock.mock.calls[0]!;
    expect(input).toEqual({ walletId: walletId!, taskIds: [task.id] });
    expect(toolCtx.caller).toMatchObject({ subject: SIGNER, clientName: "app", botId: null });
    expect(toolCtx.caller.addresses).toContain(SIGNER);
    expect(typeof deps.fetchFreeUtxos).toBe("function");
    expect(deps.omitCard).toBe(true);

    prepareTaskPayoutPreviewMock.mockResolvedValue({
      status: 409,
      body: { error: "already has a payout", code: "TASK_NOT_PAYABLE", taskIds: [task.id] },
    });
    await expect(signer.task.preparePayout({ walletId: walletId!, taskIds: [task.id] })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "already has a payout",
    });
  });

  it("confirms only an app-issued token for this signer's wallet and returns the created transaction", async () => {
    const { signer } = await seed();
    const spec = {
      v: 1 as const,
      walletId: walletId!,
      outputs: [{ address: RECIPIENT, assets: [{ unit: "lovelace", quantity: "5000000" }] }],
      certificates: [],
      votes: [],
      description: "Payout: x",
      metadataMessage: "",
    };
    runTransactionProposeMock.mockResolvedValue({
      status: 201,
      body: {
        transactionId: "tx-created",
        alreadyExisted: false,
        txHash: "beef",
        txHashChanged: false,
        txHashChangeReasons: [],
        link: "http://localhost:3000/wallets/x/transactions",
        summary: { kind: "pending" },
      },
      audit: { walletId: walletId!, transactionId: "tx-created" },
    });

    const good = mintDraftToken({
      subject: SIGNER,
      walletId: walletId!,
      clientId: "app",
      spec,
      previewTxHash: "beef",
      origin: { kind: "tasks", taskIds: ["t1"], recipientsHash: "ff".repeat(32) },
    }).token;
    const result = await signer.task.confirmPayout({ draftToken: good });
    expect(result).toMatchObject({ transactionId: "tx-created", txHash: "beef", taskIds: ["t1"] });
    const [, toolCtx, deps] = runTransactionProposeMock.mock.calls[0]!;
    expect(toolCtx.caller.clientName).toBe("app");
    expect(deps).toMatchObject({ via: "app", omitCard: true });
    // The task hooks are attached so the tasks get linked.
    expect(typeof deps.afterCreate).toBe("function");
    expect(typeof deps.txJsonExtras).toBe("function");

    // A token minted for an MCP client is not redeemable here.
    const mcpToken = mintDraftToken({ subject: SIGNER, walletId: walletId!, clientId: null, spec, previewTxHash: "beef" }).token;
    await expect(signer.task.confirmPayout({ draftToken: mcpToken })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Nor one for another wallet the caller cannot access.
    const foreign = mintDraftToken({
      subject: SIGNER,
      walletId: "no-such-wallet",
      clientId: "app",
      spec: { ...spec, walletId: "no-such-wallet" },
      previewTxHash: "beef",
    }).token;
    await expect(signer.task.confirmPayout({ draftToken: foreign })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(runTransactionProposeMock).toHaveBeenCalledTimes(1);
  });
});
