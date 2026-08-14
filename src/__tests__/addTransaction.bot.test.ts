import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { BOT_TEST_ADDRESS, createMockResponse, makeBearerAuth, makeBotJwtPayload } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string) => boolean>();
const enforceBodySizeMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, maxBytes: number) => boolean>();
const verifyJwtMock: jest.Mock = jest.fn();
const isBotJwtMock: jest.Mock = jest.fn();
const assertBotWalletAccessMock: jest.Mock = jest.fn();
const botHasScopeMock: jest.Mock = jest.fn();
const createTransactionMock: jest.Mock = jest.fn();
const transactionFromHexMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  applyBotRateLimit: applyBotRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}));

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: verifyJwtMock,
  isBotJwt: isBotJwtMock,
}));

jest.mock("@/lib/auth/botAccess", () => ({
  BotAccessError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  botHasScope: botHasScopeMock,
  __esModule: true,
  assertBotWalletAccess: assertBotWalletAccessMock,
}));

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: () => ({ submitTx: jest.fn() }),
}));

jest.mock("@meshsdk/core-csl", () => ({
  __esModule: true,
  csl: {
    Transaction: {
      from_hex: transactionFromHexMock,
    },
  },
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    transaction: { create: createTransactionMock },
    wallet: { findUnique: jest.fn() },
  },
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/addTransaction"));
});

beforeEach(() => {
  jest.clearAllMocks();
  (botHasScopeMock as any).mockResolvedValue(true);
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue(makeBotJwtPayload());
  isBotJwtMock.mockReturnValue(true);
  transactionFromHexMock.mockReturnValue({});
  (assertBotWalletAccessMock as any).mockResolvedValue({
    wallet: { id: "wallet-1", signersAddresses: [BOT_TEST_ADDRESS], numRequiredSigners: 2, type: "atLeast" },
    role: "cosigner",
  });
  (createTransactionMock as any).mockResolvedValue({ id: "tx-1" });
});

describe("addTransaction bot API", () => {
  it("rejects a scope-less bot with 403 before body validation runs", async () => {
    (botHasScopeMock as any).mockResolvedValue(false);
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      // Deliberately invalid body: the scope gate must fire first.
      body: {},
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Insufficient scope: multisig:sign required" });
    expect(assertBotWalletAccessMock).not.toHaveBeenCalled();
  });

  it("returns 403 when bot wallet access fails", async () => {
    (assertBotWalletAccessMock as any).mockRejectedValue(new Error("no access"));
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        walletId: "wallet-1",
        address: BOT_TEST_ADDRESS,
        txCbor: "deadbeef",
        txJson: "{}",
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("creates pending transaction for authorized bot", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        walletId: "wallet-1",
        address: BOT_TEST_ADDRESS,
        txCbor: "deadbeef",
        txJson: "{}",
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(createTransactionMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: "tx-1" });
  });
});
