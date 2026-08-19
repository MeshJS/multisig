import { beforeAll, afterEach, describe, expect, it, jest } from "@jest/globals";

import { realTestAddresses } from "../testUtils";
import { cleanupFixtures, seedWallet } from "./fixtures";
import { makeWalletCtx } from "./helpers";

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

const HAVE_DB = !!process.env.DATABASE_URL;
const describeWithDb = HAVE_DB ? describe : describe.skip;

let createCaller: typeof import("@/server/api/root").createCaller;
let db: typeof import("@/server/db").db;
let walletId: string | undefined;
let otherWalletId: string | undefined;

const SIGNER = realTestAddresses.address1;

const baseInput = () => ({
  walletId: walletId!,
  txJson: JSON.stringify({ body: "replacement" }),
  signedAddresses: [SIGNER],
  txCbor: "cafebabe",
  state: 0,
});

// The "edit pending transaction" flow: createTransaction with `replaces`
// atomically deletes the pending tx being edited and creates its replacement.
describeWithDb("transaction.createTransaction with replaces", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
    ({ db } = await import("@/server/db"));
  });

  afterEach(async () => {
    if (walletId) {
      await cleanupFixtures(db, { walletId });
      walletId = undefined;
    }
    if (otherWalletId) {
      await cleanupFixtures(db, { walletId: otherWalletId });
      otherWalletId = undefined;
    }
  });

  async function seedCaller() {
    ({ walletId } = await seedWallet(db, SIGNER));
    return createCaller(makeWalletCtx(SIGNER, db) as any);
  }

  async function seedPendingTx(overrides: Record<string, unknown> = {}) {
    return db.transaction.create({
      data: {
        walletId: walletId!,
        txJson: JSON.stringify({ body: "original" }),
        txCbor: "deadbeef",
        signedAddresses: [SIGNER],
        rejectedAddresses: [],
        state: 0,
        ...overrides,
      },
    });
  }

  it("deletes the old pending transaction and creates the replacement", async () => {
    const caller = await seedCaller();
    const old = await seedPendingTx();

    const replacement = await caller.transaction.createTransaction({
      ...baseInput(),
      replaces: { transactionId: old.id, knownSignedCount: 1 },
    });

    await expect(
      db.transaction.findUnique({ where: { id: old.id } }),
    ).resolves.toBeNull();
    const rows = await db.transaction.findMany({ where: { walletId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: replacement.id,
      txJson: JSON.stringify({ body: "replacement" }),
      state: 0,
    });
  });

  it("audits both the delete and the create", async () => {
    const caller = await seedCaller();
    const old = await seedPendingTx();

    const replacement = await caller.transaction.createTransaction({
      ...baseInput(),
      replaces: { transactionId: old.id, knownSignedCount: 1 },
    });

    // audit() is fire-and-forget; give the writes a beat to land.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const deleteAudit = await db.auditLog.findFirst({
      where: { action: "transaction.delete", resourceId: old.id },
    });
    const createAudit = await db.auditLog.findFirst({
      where: { action: "transaction.create", resourceId: replacement.id },
    });
    expect(deleteAudit?.metadata).toMatchObject({ replacedBy: replacement.id });
    expect(createAudit?.metadata).toMatchObject({ replaces: old.id });
    await db.auditLog.deleteMany({
      where: { resourceId: { in: [old.id, replacement.id] } },
    });
  });

  it("conflicts when the old transaction was already submitted", async () => {
    const caller = await seedCaller();
    const old = await seedPendingTx({ state: 1, txHash: "abc123" });

    await expect(
      caller.transaction.createTransaction({
        ...baseInput(),
        replaces: { transactionId: old.id, knownSignedCount: 1 },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Nothing created, original untouched.
    const rows = await db.transaction.findMany({ where: { walletId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(old.id);
  });

  it("conflicts when signatures were collected since the user confirmed", async () => {
    const caller = await seedCaller();
    const old = await seedPendingTx({
      signedAddresses: [SIGNER, realTestAddresses.address2],
    });

    await expect(
      caller.transaction.createTransaction({
        ...baseInput(),
        replaces: { transactionId: old.id, knownSignedCount: 1 },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      db.transaction.findUnique({ where: { id: old.id } }),
    ).resolves.not.toBeNull();
    await expect(
      db.transaction.findMany({ where: { walletId } }),
    ).resolves.toHaveLength(1);
  });

  it("returns NOT_FOUND when the old transaction is gone", async () => {
    const caller = await seedCaller();

    await expect(
      caller.transaction.createTransaction({
        ...baseInput(),
        replaces: { transactionId: "nonexistent-tx", knownSignedCount: 0 },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      db.transaction.findMany({ where: { walletId } }),
    ).resolves.toHaveLength(0);
  });

  it("returns NOT_FOUND when the old transaction belongs to another wallet", async () => {
    const caller = await seedCaller();
    ({ walletId: otherWalletId } = await seedWallet(db, SIGNER));
    const foreign = await db.transaction.create({
      data: {
        walletId: otherWalletId,
        txJson: JSON.stringify({ body: "foreign" }),
        txCbor: "deadbeef",
        signedAddresses: [],
        rejectedAddresses: [],
        state: 0,
      },
    });

    await expect(
      caller.transaction.createTransaction({
        ...baseInput(),
        replaces: { transactionId: foreign.id, knownSignedCount: 0 },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The foreign wallet's transaction must survive.
    await expect(
      db.transaction.findUnique({ where: { id: foreign.id } }),
    ).resolves.not.toBeNull();
    await expect(
      db.transaction.findMany({ where: { walletId } }),
    ).resolves.toHaveLength(0);
  });
});
