import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { makeAnonymousCtx, makeSessionCtx, makeWalletCtx } from "./helpers";

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

let createCaller: typeof import("@/server/api/root").createCaller;

const makeMockDb = () => ({
  wallet: { findUnique: jest.fn() },
  proxy: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  user: { findUnique: jest.fn() },
});

const proxyInput = {
  proxyAddress: "addr_test1proxy",
  authTokenId: "token-1",
  paramUtxo: "txhash#0",
};

describe("proxy router authorization", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws UNAUTHORIZED when session is missing", async () => {
    const mockDb = makeMockDb();
    const caller = createCaller(makeAnonymousCtx(mockDb) as any);

    await expect(
      caller.proxy.createProxy({
        walletId: "wallet-1",
        ...proxyInput,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(mockDb.proxy.create).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when wallet caller is not a signer", async () => {
    const mockDb = makeMockDb();
    mockDb.wallet.findUnique.mockResolvedValueOnce({
      id: "wallet-1",
      signersAddresses: ["addr_signer"],
      ownerAddress: "addr_outsider",
    } as never);
    const caller = createCaller(makeWalletCtx("addr_outsider", mockDb) as any);

    await expect(
      caller.proxy.createProxy({
        walletId: "wallet-1",
        ...proxyInput,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mockDb.proxy.create).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when userId is given but user does not exist", async () => {
    const mockDb = makeMockDb();
    mockDb.user.findUnique.mockResolvedValueOnce(null as never);
    const caller = createCaller(makeSessionCtx("addr_user", mockDb) as any);

    await expect(
      caller.proxy.createProxy({
        userId: "user-1",
        ...proxyInput,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(mockDb.proxy.create).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when userId belongs to another user", async () => {
    const mockDb = makeMockDb();
    mockDb.user.findUnique.mockResolvedValueOnce({ id: "different-user" } as never);
    const caller = createCaller(makeSessionCtx("addr_user", mockDb) as any);

    await expect(
      caller.proxy.createProxy({
        userId: "user-1",
        ...proxyInput,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mockDb.proxy.create).not.toHaveBeenCalled();
  });

  it("allows walletId when caller is a signer", async () => {
    const mockDb = makeMockDb();
    mockDb.wallet.findUnique.mockResolvedValueOnce({
      id: "wallet-1",
      signersAddresses: ["addr_signer"],
    } as never);
    mockDb.proxy.create.mockResolvedValueOnce({
      id: "proxy-1",
      walletId: "wallet-1",
      isActive: true,
    } as never);
    const caller = createCaller(makeWalletCtx("addr_signer", mockDb) as any);

    await expect(
      caller.proxy.createProxy({
        walletId: "wallet-1",
        ...proxyInput,
      }),
    ).resolves.toMatchObject({ id: "proxy-1", walletId: "wallet-1" });
  });

  it("rejects input with neither walletId nor userId", async () => {
    const mockDb = makeMockDb();
    const caller = createCaller(makeWalletCtx("addr_signer", mockDb) as any);

    await expect(caller.proxy.createProxy(proxyInput)).rejects.toBeInstanceOf(Error);

    expect(mockDb.wallet.findUnique).not.toHaveBeenCalled();
    expect(mockDb.proxy.create).not.toHaveBeenCalled();
  });
});
