import { afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";

import { realTestAddresses } from "../testUtils";
import { cleanupFixtures, seedWallet } from "./fixtures";
import { makeWalletCtx } from "./helpers";

jest.mock("@/env", () => ({
  __esModule: true,
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    NODE_ENV: "test",
  },
}), { virtual: true });

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
let walletIds: string[] = [];

const SIGNER = realTestAddresses.address1;

describeWithDb("transaction.getPendingTransactions", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
    ({ db } = await import("@/server/db"));
  });

  afterEach(async () => {
    for (const walletId of walletIds) {
      await cleanupFixtures(db, { walletId });
    }
    walletIds = [];
  });

  async function seedCaller() {
    const seeded = await seedWallet(db, SIGNER);
    walletIds.push(seeded.walletId);
    return {
      walletId: seeded.walletId,
      caller: createCaller(makeWalletCtx(SIGNER, db) as any),
    };
  }

  async function createTransaction(walletId: string, state: number, txCbor = "deadbeef") {
    return db.transaction.create({
      data: {
        walletId,
        txJson: JSON.stringify({ body: { state } }),
        txCbor,
        signedAddresses: [],
        rejectedAddresses: [],
        state,
      },
    });
  }

  it("returns an empty array when there are no pending transactions", async () => {
    const { caller, walletId } = await seedCaller();

    await expect(caller.transaction.getPendingTransactions({ walletId })).resolves.toEqual([]);
  });

  it("returns a pending state-0 transaction", async () => {
    const { caller, walletId } = await seedCaller();
    const tx = await createTransaction(walletId, 0);

    const result = await caller.transaction.getPendingTransactions({ walletId });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(tx.id);
  });

  it("does not return a completed state-1 transaction", async () => {
    const { caller, walletId } = await seedCaller();
    await createTransaction(walletId, 1);

    await expect(caller.transaction.getPendingTransactions({ walletId })).resolves.toEqual([]);
  });

  it("orders multiple pending transactions by createdAt descending", async () => {
    const { caller, walletId } = await seedCaller();
    const older = await createTransaction(walletId, 0, "aa");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const newer = await createTransaction(walletId, 0, "bb");

    const result = await caller.transaction.getPendingTransactions({ walletId });

    expect(result.map((tx) => tx.id)).toEqual([newer.id, older.id]);
  });

  it("does not return transactions from another wallet", async () => {
    const { caller, walletId } = await seedCaller();
    const other = await seedWallet(db, SIGNER);
    walletIds.push(other.walletId);
    const ownTx = await createTransaction(walletId, 0, "aa");
    await createTransaction(other.walletId, 0, "bb");

    const result = await caller.transaction.getPendingTransactions({ walletId });

    expect(result.map((tx) => tx.id)).toEqual([ownTx.id]);
  });
});
