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
const checkSignatureMock: jest.Mock = jest.fn();
const createSignableMock: jest.Mock = jest.fn();

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

jest.mock("@meshsdk/core-cst", () => ({
  __esModule: true,
  checkSignature: checkSignatureMock,
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    signable: { create: createSignableMock },
    wallet: { findUnique: jest.fn() },
  },
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/submitDatum"));
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
  (assertBotWalletAccessMock as any).mockResolvedValue({ wallet: { id: "wallet-1" } });
  (checkSignatureMock as any).mockResolvedValue(true);
  (createSignableMock as any).mockResolvedValue({ id: "sig-1" });
});

describe("submitDatum bot API", () => {
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
  it("returns 401 for invalid datum signature", async () => {
    (checkSignatureMock as any).mockResolvedValue(false);
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        walletId: "wallet-1",
        signature: "sig",
        key: "key",
        address: BOT_TEST_ADDRESS,
        datum: "payload",
        callbackUrl: "https://example.com/callback",
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("creates signable datum for authorized bot", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        walletId: "wallet-1",
        signature: "sig",
        key: "key",
        address: BOT_TEST_ADDRESS,
        datum: "payload",
        callbackUrl: "https://example.com/callback",
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(createSignableMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: "sig-1" });
  });
});
