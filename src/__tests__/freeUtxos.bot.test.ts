import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { BOT_TEST_ADDRESS, createMockResponse, makeBearerAuth, makeBotJwtPayload } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string) => boolean>();
const verifyJwtMock: jest.Mock = jest.fn();
const isBotJwtMock: jest.Mock = jest.fn();
const getBotWalletAccessMock: jest.Mock = jest.fn();
const assertBotWalletAccessMock: jest.Mock = jest.fn();
const findPendingTransactionsMock: jest.Mock = jest.fn();
const buildMultisigWalletMock: jest.Mock = jest.fn();
const addressToNetworkMock: jest.Mock = jest.fn();
const getProviderMock: jest.Mock = jest.fn();
const cachedFetchAddressUTxOsMock: jest.Mock = jest.fn();
const serializeNativeScriptMock: jest.Mock = jest.fn();
const decodeNativeScriptFromCborMock: jest.Mock = jest.fn();
const decodedToNativeScriptMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}), { virtual: true });

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  applyBotRateLimit: applyBotRateLimitMock,
}), { virtual: true });

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: verifyJwtMock,
  isBotJwt: isBotJwtMock,
}), { virtual: true });

jest.mock("@/lib/auth/botAccess", () => ({
  __esModule: true,
  getBotWalletAccess: getBotWalletAccessMock,
  assertBotWalletAccess: assertBotWalletAccessMock,
}), { virtual: true });

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    transaction: { findMany: findPendingTransactionsMock },
  },
}), { virtual: true });

jest.mock("@/utils/common", () => ({
  __esModule: true,
  buildMultisigWallet: buildMultisigWalletMock,
}), { virtual: true });

jest.mock("@/utils/multisigSDK", () => ({
  __esModule: true,
  addressToNetwork: addressToNetworkMock,
}), { virtual: true });

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: getProviderMock,
}), { virtual: true });

jest.mock("@/utils/blockchain-cache", () => ({
  __esModule: true,
  cachedFetchAddressUTxOs: cachedFetchAddressUTxOsMock,
}), { virtual: true });

jest.mock("@/utils/nativeScriptUtils", () => ({
  __esModule: true,
  decodeNativeScriptFromCbor: decodeNativeScriptFromCborMock,
  decodedToNativeScript: decodedToNativeScriptMock,
}), { virtual: true });

jest.mock("@meshsdk/core", () => ({
  __esModule: true,
  serializeNativeScript: serializeNativeScriptMock,
}), { virtual: true });

jest.mock("@/server/api/root", () => ({
  __esModule: true,
  createCaller: () => ({
    transaction: { getPendingTransactions: jest.fn() },
    wallet: { getWallet: jest.fn() },
  }),
}), { virtual: true });

jest.mock("@/lib/security/rateLimit", () => ({
  __esModule: true,
  getClientIP: () => "127.0.0.1",
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/freeUtxos"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue(makeBotJwtPayload());
  isBotJwtMock.mockReturnValue(true);
  (getBotWalletAccessMock as any).mockResolvedValue({ allowed: true, role: "cosigner" });
  (findPendingTransactionsMock as any).mockResolvedValue([]);
  (assertBotWalletAccessMock as any).mockResolvedValue({ wallet: { id: "wallet-1" }, role: "cosigner" });
  buildMultisigWalletMock.mockReturnValue({
    getScript: () => ({ address: "addr_test1walletscript" }),
  });
  decodeNativeScriptFromCborMock.mockReturnValue({ any: "decoded" });
  decodedToNativeScriptMock.mockReturnValue({ type: "all", scripts: [] });
  serializeNativeScriptMock.mockReturnValue({ address: "addr_test1canonicalwalletscript" });
  addressToNetworkMock.mockReturnValue(0);
  getProviderMock.mockReturnValue({ get: jest.fn() });
  (cachedFetchAddressUTxOsMock as any).mockResolvedValue([
    { input: { txHash: "a", outputIndex: 0 } },
  ]);
});

describe("freeUtxos bot API", () => {
  it("returns 403 when bot lacks wallet access", async () => {
    (getBotWalletAccessMock as any).mockResolvedValue({ allowed: false });
    const req = {
      method: "GET",
      headers: makeBearerAuth(),
      query: { walletId: "wallet-1", address: BOT_TEST_ADDRESS },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns free utxos for authorized bot", async () => {
    const req = {
      method: "GET",
      headers: makeBearerAuth(),
      query: { walletId: "wallet-1", address: BOT_TEST_ADDRESS },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(cachedFetchAddressUTxOsMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([{ input: { txHash: "a", outputIndex: 0 } }]);
  });

  it("falls back to canonical scriptCbor when multisig wallet is unavailable", async () => {
    buildMultisigWalletMock.mockReturnValue(undefined);
    (assertBotWalletAccessMock as any).mockResolvedValue({
      wallet: {
        id: "wallet-1",
        scriptCbor: "canonical-cbor",
        signersAddresses: [BOT_TEST_ADDRESS],
        stakeCredentialHash: null,
      },
      role: "cosigner",
    });

    const req = {
      method: "GET",
      headers: makeBearerAuth(),
      query: { walletId: "wallet-1", address: BOT_TEST_ADDRESS },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(decodeNativeScriptFromCborMock).toHaveBeenCalledWith("canonical-cbor");
    expect(serializeNativeScriptMock).toHaveBeenCalled();
    expect(cachedFetchAddressUTxOsMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns clear 500 when canonical script fallback cannot decode", async () => {
    buildMultisigWalletMock.mockReturnValue(undefined);
    decodeNativeScriptFromCborMock.mockImplementation(() => {
      throw new Error("invalid canonical cbor");
    });
    (assertBotWalletAccessMock as any).mockResolvedValue({
      wallet: {
        id: "wallet-1",
        scriptCbor: "broken-cbor",
        signersAddresses: [BOT_TEST_ADDRESS],
        stakeCredentialHash: null,
      },
      role: "cosigner",
    });

    const req = {
      method: "GET",
      headers: makeBearerAuth(),
      query: { walletId: "wallet-1", address: BOT_TEST_ADDRESS },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Wallet script address resolution failed: invalid canonical cbor",
    });
  });
});
