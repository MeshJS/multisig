import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { makeAnonymousCtx, makeSessionCtx, makeWalletCtx } from "./helpers";

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

const SIGNER = "addr_test1signer";
const OTHER = "addr_test1other";

const walletRow = {
  id: "wallet-1",
  name: "Treasury",
  description: "Board treasury",
  signersAddresses: [SIGNER, OTHER],
  signersDescriptions: ["Alice", "Bob"],
};

const makeMockDb = () => ({
  wallet: {
    findMany: jest.fn(async (_args: unknown) => [walletRow]),
  },
});

/**
 * wallet.getUserWallets lists every wallet that names an address as a signer.
 * Signer addresses are public on-chain, so the address alone proves nothing:
 * the caller must hold a session for it.
 */
describe("wallet.getUserWallets authorization", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("refuses an anonymous caller without touching the database", async () => {
    const db = makeMockDb();
    const caller = createCaller(makeAnonymousCtx(db) as any);

    await expect(
      caller.wallet.getUserWallets({ address: SIGNER }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(db.wallet.findMany).not.toHaveBeenCalled();
  });

  it("refuses a wallet session asking for someone else's address", async () => {
    const db = makeMockDb();
    const caller = createCaller(makeWalletCtx(OTHER, db) as any);

    await expect(
      caller.wallet.getUserWallets({ address: SIGNER }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(db.wallet.findMany).not.toHaveBeenCalled();
  });

  it("refuses a NextAuth session asking for someone else's address", async () => {
    const db = makeMockDb();
    const caller = createCaller(makeSessionCtx(OTHER, db) as any);

    await expect(
      caller.wallet.getUserWallets({ address: SIGNER }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(db.wallet.findMany).not.toHaveBeenCalled();
  });

  it("lists the wallets of the address the wallet session holds", async () => {
    const db = makeMockDb();
    const caller = createCaller(makeWalletCtx(SIGNER, db) as any);

    await expect(
      caller.wallet.getUserWallets({ address: SIGNER }),
    ).resolves.toEqual([walletRow]);

    expect(db.wallet.findMany).toHaveBeenCalledWith({
      where: { signersAddresses: { has: SIGNER } },
    });
  });

  it("lists the wallets for any address in a multi-wallet session", async () => {
    const db = makeMockDb();
    const ctx = { ...makeWalletCtx(OTHER, db), sessionWallets: [OTHER, SIGNER] };
    const caller = createCaller(ctx as any);

    await expect(
      caller.wallet.getUserWallets({ address: SIGNER }),
    ).resolves.toEqual([walletRow]);
  });

  it("lists the wallets of a NextAuth user's own address", async () => {
    const db = makeMockDb();
    const caller = createCaller(makeSessionCtx(SIGNER, db) as any);

    await expect(
      caller.wallet.getUserWallets({ address: SIGNER }),
    ).resolves.toEqual([walletRow]);
  });
});
