import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyStrictRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const enforceBodySizeMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, maxBytes: number) => boolean>();
const verifyBotKeySecretMock = jest.fn<(secret: string, hash: string) => boolean>();
const parseScopeMock = jest.fn<(scope: string) => string[]>();
const scopeIncludesMock = jest.fn<(scopes: string[], minScope: string) => boolean>();
const signMock: jest.Mock = jest.fn();
const findBotKeyMock: jest.Mock = jest.fn();
const findBotUserByAddressMock: jest.Mock = jest.fn();
const upsertBotUserMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}), { virtual: true });

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyStrictRateLimit: applyStrictRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}), { virtual: true });

jest.mock("@/lib/auth/botKey", () => ({
  __esModule: true,
  verifyBotKeySecret: verifyBotKeySecretMock,
  parseScope: parseScopeMock,
  scopeIncludes: scopeIncludesMock,
}), { virtual: true });

jest.mock("jsonwebtoken", () => ({
  __esModule: true,
  sign: signMock,
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    botKey: { findUnique: findBotKeyMock },
    botUser: {
      findUnique: findBotUserByAddressMock,
      upsert: upsertBotUserMock,
    },
  },
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

beforeAll(async () => {
  process.env.JWT_SECRET = "x".repeat(32);
  ({ default: handler } = await import("../pages/api/v1/botAuth"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyStrictRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyBotKeySecretMock.mockReturnValue(true);
  parseScopeMock.mockReturnValue(["multisig:read"]);
  scopeIncludesMock.mockReturnValue(true);
  signMock.mockReturnValue("signed-jwt");
  (findBotKeyMock as any).mockResolvedValue({
    id: "bot-key-id",
    keyHash: "hashed",
    scope: JSON.stringify(["multisig:read"]),
  });
  (findBotUserByAddressMock as any).mockResolvedValue(null);
  (upsertBotUserMock as any).mockResolvedValue({
    id: "bot-user-id",
    paymentAddress: "addr_test1qpbot00000000000000000000000000000000000",
  });
});

describe("botAuth API", () => {
  it("returns 401 for invalid bot secret", async () => {
    verifyBotKeySecretMock.mockReturnValue(false);
    const req = {
      method: "POST",
      body: {
        botKeyId: "bot-key-id",
        secret: "wrong",
        paymentAddress: "addr_test1qpbot00000000000000000000000000000000000",
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid bot key" });
  });

  it("returns token and botId for valid request", async () => {
    const req = {
      method: "POST",
      body: {
        botKeyId: "bot-key-id",
        secret: "secret",
        paymentAddress: "addr_test1qpbot00000000000000000000000000000000000",
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(upsertBotUserMock).toHaveBeenCalled();
    expect(signMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      token: "signed-jwt",
      botId: "bot-user-id",
    });
  });
});
