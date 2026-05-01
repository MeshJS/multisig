import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { BOT_TEST_ADDRESS, BOT_TEST_ID, makeBotJwtPayload } from "./apiTestUtils";

const isBotJwtMock: jest.Mock = jest.fn();
const getBotWalletAccessMock: jest.Mock = jest.fn();

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  isBotJwt: isBotJwtMock,
}), { virtual: true });

jest.mock("@/lib/auth/botAccess", () => ({
  __esModule: true,
  getBotWalletAccess: getBotWalletAccessMock,
}), { virtual: true });

const wallet = {
  id: "wallet-1",
  signersAddresses: [BOT_TEST_ADDRESS],
};

function createDb(walletRow: unknown = wallet) {
  return {
    wallet: {
      findUnique: jest.fn(async () => walletRow),
    },
    proxy: {
      findFirst: jest.fn(),
    },
  };
}

describe("proxyAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows observer bots to read proxies", async () => {
    const { authorizeProxyReadForV1 } = await import("@/lib/server/proxyAccess");
    const db = createDb();
    isBotJwtMock.mockReturnValue(true);
    (getBotWalletAccessMock as any).mockResolvedValue({
      allowed: true,
      role: "observer",
    });

    await expect(
      authorizeProxyReadForV1({
        db: db as never,
        payload: makeBotJwtPayload(),
        walletId: "wallet-1",
        address: BOT_TEST_ADDRESS,
      }),
    ).resolves.toEqual({ wallet });

    expect(getBotWalletAccessMock).toHaveBeenCalledWith(
      db,
      "wallet-1",
      BOT_TEST_ID,
    );
  });

  it("rejects address mismatches before wallet access checks", async () => {
    const { authorizeProxyReadForV1 } = await import("@/lib/server/proxyAccess");
    const db = createDb();

    await expect(
      authorizeProxyReadForV1({
        db: db as never,
        payload: makeBotJwtPayload({ address: "addr_test_other" }),
        walletId: "wallet-1",
        address: BOT_TEST_ADDRESS,
      }),
    ).rejects.toMatchObject({ code: "ADDRESS_MISMATCH" });
    expect(db.wallet.findUnique).not.toHaveBeenCalled();
  });

  it("allows human signers to read proxies", async () => {
    const { authorizeProxyReadForV1 } = await import("@/lib/server/proxyAccess");
    const db = createDb();
    isBotJwtMock.mockReturnValue(false);

    await expect(
      authorizeProxyReadForV1({
        db: db as never,
        payload: { address: BOT_TEST_ADDRESS } as never,
        walletId: "wallet-1",
        address: BOT_TEST_ADDRESS,
      }),
    ).resolves.toEqual({ wallet });
  });

  it("loads only active proxies for the requested wallet", async () => {
    const { loadActiveProxyForWallet } = await import("@/lib/server/proxyAccess");
    const proxy = { id: "proxy-1", isActive: true };
    const db = createDb();
    (db.proxy.findFirst as any).mockResolvedValue(proxy);

    await expect(
      loadActiveProxyForWallet({
        db: db as never,
        walletId: "wallet-1",
        proxyId: "proxy-1",
      }),
    ).resolves.toBe(proxy);
    expect(db.proxy.findFirst).toHaveBeenCalledWith({
      where: { id: "proxy-1", walletId: "wallet-1", isActive: true },
    });
  });
});
