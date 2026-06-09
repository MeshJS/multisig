import { afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";

import { realTestAddresses } from "../testUtils";
import { cleanupFixtures, seedUser, seedWallet } from "./fixtures";
import { makeSessionCtx, makeWalletCtx } from "./helpers";

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
let userIds: string[] = [];

const SIGNER = realTestAddresses.address1;
const USER_ADDR = realTestAddresses.address2;

const proxyInput = {
  proxyAddress: "addr_test1proxy",
  authTokenId: "auth-token-1",
  paramUtxo: "txhash#0",
};

describeWithDb("proxy.createProxy", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
    ({ db } = await import("@/server/db"));
  });

  afterEach(async () => {
    for (const walletId of walletIds) {
      await cleanupFixtures(db, { walletId });
    }
    for (const userId of userIds) {
      await cleanupFixtures(db, { userId });
    }
    walletIds = [];
    userIds = [];
  });

  async function seedWalletCaller(address = SIGNER) {
    const seeded = await seedWallet(db, SIGNER);
    walletIds.push(seeded.walletId);
    return {
      walletId: seeded.walletId,
      caller: createCaller(makeWalletCtx(address, db) as any),
    };
  }

  async function seedUserCaller(address = USER_ADDR) {
    const seeded = await seedUser(db, address);
    userIds.push(seeded.userId);
    return {
      userId: seeded.userId,
      caller: createCaller(makeSessionCtx(address, db) as any),
    };
  }

  it("creates an active wallet-owned proxy", async () => {
    const { caller, walletId } = await seedWalletCaller();

    const result = await caller.proxy.createProxy({
      walletId,
      ...proxyInput,
    });

    expect(result).toMatchObject({
      walletId,
      userId: null,
      proxyAddress: proxyInput.proxyAddress,
      authTokenId: proxyInput.authTokenId,
      paramUtxo: proxyInput.paramUtxo,
      isActive: true,
    });
  });

  it("creates an active user-owned proxy", async () => {
    const { caller, userId } = await seedUserCaller();

    const result = await caller.proxy.createProxy({
      userId,
      ...proxyInput,
    });

    expect(result).toMatchObject({
      walletId: null,
      userId,
      isActive: true,
    });
  });

  it("defaults isActive to true", async () => {
    const { caller, walletId } = await seedWalletCaller();

    const result = await caller.proxy.createProxy({
      walletId,
      ...proxyInput,
    });

    expect(result.isActive).toBe(true);
  });

  it("persists an optional description", async () => {
    const { caller, walletId } = await seedWalletCaller();

    const result = await caller.proxy.createProxy({
      walletId,
      ...proxyInput,
      description: "bot",
    });

    expect(result.description).toBe("bot");
  });

  it("rejects input with neither walletId nor userId", async () => {
    const { caller } = await seedWalletCaller();

    await expect(caller.proxy.createProxy(proxyInput)).rejects.toBeInstanceOf(Error);
  });

  it("throws FORBIDDEN when caller is not a wallet signer", async () => {
    const { caller, walletId } = await seedWalletCaller(USER_ADDR);

    await expect(
      caller.proxy.createProxy({
        walletId,
        ...proxyInput,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws FORBIDDEN when caller is a different user", async () => {
    const { userId } = await seedUserCaller(USER_ADDR);
    const other = await seedUser(db, SIGNER);
    userIds.push(other.userId);
    const caller = createCaller(makeSessionCtx(SIGNER, db) as any);

    await expect(
      caller.proxy.createProxy({
        userId,
        ...proxyInput,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns created wallet proxies through getProxiesByWallet", async () => {
    const { caller, walletId } = await seedWalletCaller();
    const created = await caller.proxy.createProxy({
      walletId,
      ...proxyInput,
    });

    const result = await caller.proxy.getProxiesByWallet({ walletId });

    expect(result.map((proxy) => proxy.id)).toContain(created.id);
  });
});
