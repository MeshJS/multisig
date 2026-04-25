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
const findPendingTransactionsMock: jest.Mock = jest.fn();

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
}), { virtual: true });

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    transaction: { findMany: findPendingTransactionsMock },
  },
}), { virtual: true });

jest.mock("@/server/api/root", () => ({
  __esModule: true,
  createCaller: () => ({}),
}), { virtual: true });

jest.mock("@/lib/security/rateLimit", () => ({
  __esModule: true,
  getClientIP: () => "127.0.0.1",
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/pendingTransactions"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue(makeBotJwtPayload());
  isBotJwtMock.mockReturnValue(true);
  (getBotWalletAccessMock as any).mockResolvedValue({ allowed: true, role: "cosigner" });
  (findPendingTransactionsMock as any).mockResolvedValue([{ id: "tx-1" }]);
});

describe("pendingTransactions bot API", () => {
  it("returns 403 when bot has no wallet access", async () => {
    (getBotWalletAccessMock as any).mockResolvedValue({ allowed: false });
    const req = {
      method: "GET",
      headers: makeBearerAuth(),
      query: { walletId: "w1", address: BOT_TEST_ADDRESS },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns pending transactions when access is allowed", async () => {
    const req = {
      method: "GET",
      headers: makeBearerAuth(),
      query: { walletId: "w1", address: BOT_TEST_ADDRESS },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(findPendingTransactionsMock).toHaveBeenCalledWith({
      where: { walletId: "w1", state: 0 },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([{ id: "tx-1" }]);
  });
});
