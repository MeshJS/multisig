import { beforeAll, afterEach, describe, expect, it, jest } from "@jest/globals";

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
let walletId: string | undefined;

const SIGNER = realTestAddresses.address1;

const baseInput = () => ({
  walletId: walletId!,
  txJson: JSON.stringify({ body: {} }),
  signedAddresses: [] as string[],
  txCbor: "deadbeef",
  state: 0,
});

describeWithDb("transaction.createTransaction", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
    ({ db } = await import("@/server/db"));
  });

  afterEach(async () => {
    if (walletId) {
      await cleanupFixtures(db, { walletId });
      walletId = undefined;
    }
  });

  async function seedCaller(address = SIGNER) {
    ({ walletId } = await seedWallet(db, SIGNER));
    return createCaller(makeWalletCtx(address, db) as any);
  }

  it("creates an unsigned pending transaction for a signer", async () => {
    const caller = await seedCaller();

    const result = await caller.transaction.createTransaction(baseInput());

    expect(result).toMatchObject({
      walletId,
      txJson: JSON.stringify({ body: {} }),
      txCbor: "deadbeef",
      signedAddresses: [],
      rejectedAddresses: [],
      state: 0,
    });
    expect(result.id).toBeTruthy();
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);

    const persisted = await db.transaction.findUnique({ where: { id: result.id } });
    expect(persisted).toMatchObject({
      id: result.id,
      walletId,
      state: 0,
      rejectedAddresses: [],
    });
  });

  it("persists an optional description", async () => {
    const caller = await seedCaller();

    const result = await caller.transaction.createTransaction({
      ...baseInput(),
      description: "my desc",
    });

    expect(result.description).toBe("my desc");
  });

  it("persists an optional transaction hash", async () => {
    const caller = await seedCaller();

    const result = await caller.transaction.createTransaction({
      ...baseInput(),
      txHash: "abc123",
    });

    expect(result.txHash).toBe("abc123");
  });

  it("rejects an empty txCbor before writing to the database", async () => {
    const caller = await seedCaller();

    await expect(
      caller.transaction.createTransaction({
        ...baseInput(),
        txCbor: "",
      }),
    ).rejects.toBeInstanceOf(Error);

    await expect(db.transaction.findMany({ where: { walletId } })).resolves.toHaveLength(0);
  });

  it("rejects an empty txJson before writing to the database", async () => {
    const caller = await seedCaller();

    await expect(
      caller.transaction.createTransaction({
        ...baseInput(),
        txJson: "",
      }),
    ).rejects.toBeInstanceOf(Error);

    await expect(db.transaction.findMany({ where: { walletId } })).resolves.toHaveLength(0);
  });

  it("throws FORBIDDEN for a non-signer caller", async () => {
    const caller = await seedCaller(realTestAddresses.address2);

    await expect(caller.transaction.createTransaction(baseInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("returns the full persisted row shape", async () => {
    const caller = await seedCaller();

    const result = await caller.transaction.createTransaction(baseInput());

    expect(result).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        walletId,
        txCbor: expect.any(String),
        txJson: expect.any(String),
        signedAddresses: expect.any(Array),
        rejectedAddresses: expect.any(Array),
        state: expect.any(Number),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
  });
});
