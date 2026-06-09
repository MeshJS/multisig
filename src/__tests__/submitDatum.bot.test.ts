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
const checkSignatureMock: jest.Mock = jest.fn();
const createSignableMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}), { virtual: true });

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  applyBotRateLimit: applyBotRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}), { virtual: true });

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: verifyJwtMock,
  isBotJwt: isBotJwtMock,
}), { virtual: true });

jest.mock("@/lib/auth/botAccess", () => ({
  __esModule: true,
  assertBotWalletAccess: assertBotWalletAccessMock,
}), { virtual: true });

jest.mock("@meshsdk/core-cst", () => ({
  __esModule: true,
  checkSignature: checkSignatureMock,
}), { virtual: true });

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    signable: { create: createSignableMock },
    wallet: { findUnique: jest.fn() },
  },
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/submitDatum"));
});

beforeEach(() => {
  jest.clearAllMocks();
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
