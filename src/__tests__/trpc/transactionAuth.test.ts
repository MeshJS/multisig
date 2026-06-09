import { describe, expect, it, jest, beforeAll, beforeEach } from "@jest/globals";

import { makeAnonymousCtx, makeWalletCtx } from "./helpers";

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
  transaction: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
});

const wallet = (overrides: Record<string, unknown> = {}) => ({
  id: "wallet-1",
  signersAddresses: ["addr_signer"],
  ownerAddress: null,
  ...overrides,
});

describe("transaction router authorization", () => {
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
      caller.transaction.createTransaction({
        walletId: "wallet-1",
        txJson: "{}",
        signedAddresses: [],
        txCbor: "deadbeef",
        state: 0,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(mockDb.wallet.findUnique).not.toHaveBeenCalled();
    expect(mockDb.transaction.create).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when wallet does not exist", async () => {
    const mockDb = makeMockDb();
    mockDb.wallet.findUnique.mockResolvedValueOnce(null as never);
    const caller = createCaller(makeWalletCtx("addr_signer", mockDb) as any);

    await expect(
      caller.transaction.createTransaction({
        walletId: "missing-wallet",
        txJson: "{}",
        signedAddresses: [],
        txCbor: "deadbeef",
        state: 0,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(mockDb.transaction.create).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when caller is not a signer", async () => {
    const mockDb = makeMockDb();
    mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
    const caller = createCaller(makeWalletCtx("addr_outsider", mockDb) as any);

    await expect(
      caller.transaction.createTransaction({
        walletId: "wallet-1",
        txJson: "{}",
        signedAddresses: [],
        txCbor: "deadbeef",
        state: 0,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mockDb.transaction.create).not.toHaveBeenCalled();
  });

  it("allows the wallet owner address", async () => {
    const mockDb = makeMockDb();
    mockDb.wallet.findUnique.mockResolvedValueOnce(
      wallet({ signersAddresses: ["addr_signer"], ownerAddress: "addr_owner" }) as never,
    );
    mockDb.transaction.create.mockResolvedValueOnce({ id: "tx-1", walletId: "wallet-1" } as never);
    const caller = createCaller(makeWalletCtx("addr_owner", mockDb) as any);

    await expect(
      caller.transaction.createTransaction({
        walletId: "wallet-1",
        txJson: "{}",
        signedAddresses: [],
        txCbor: "deadbeef",
        state: 0,
      }),
    ).resolves.toMatchObject({ id: "tx-1" });
  });

  it("allows a signer from the wallet-session context", async () => {
    const mockDb = makeMockDb();
    mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
    mockDb.transaction.create.mockResolvedValueOnce({ id: "tx-1", walletId: "wallet-1" } as never);
    const caller = createCaller(makeWalletCtx("addr_signer", mockDb) as any);

    await expect(
      caller.transaction.createTransaction({
        walletId: "wallet-1",
        txJson: "{}",
        signedAddresses: ["addr_signer"],
        txCbor: "deadbeef",
        state: 0,
      }),
    ).resolves.toMatchObject({ id: "tx-1" });
  });
});
