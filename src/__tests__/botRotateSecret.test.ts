import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyStrictRateLimitMock = jest.fn<() => boolean>();
const enforceBodySizeMock = jest.fn<() => boolean>();
const verifyBotKeySecretMock = jest.fn<(secret: string, hash: string) => boolean>();
const findBotKeyMock: jest.Mock = jest.fn();
const updateBotKeyMock: jest.Mock = jest.fn();
const auditMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyStrictRateLimit: applyStrictRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}));

jest.mock("@/lib/auth/botKey", () => ({
  __esModule: true,
  verifyBotKeySecret: verifyBotKeySecretMock,
  generateBotKeySecret: () => "new-secret-hex",
  hashBotKeySecret: (secret: string) => `hashed:${secret}`,
}));

jest.mock("@/lib/observability/audit", () => ({
  __esModule: true,
  audit: auditMock,
}));

jest.mock("@/lib/security/rateLimit", () => ({
  __esModule: true,
  getClientIP: () => "1.2.3.4",
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    botKey: { findUnique: findBotKeyMock, update: updateBotKeyMock },
  },
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/botRotateSecret"));
});

function rotateRequest(body: Record<string, unknown>): NextApiRequest {
  return { method: "POST", headers: {}, body } as unknown as NextApiRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  applyStrictRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyBotKeySecretMock.mockReturnValue(true);
  (findBotKeyMock as any).mockResolvedValue({
    id: "botkey-1",
    ownerAddress: "addr_owner",
    keyHash: "hashed:old-secret",
  });
  (updateBotKeyMock as any).mockResolvedValue({ id: "botkey-1" });
  (auditMock as any).mockResolvedValue(undefined);
});

describe("botRotateSecret API", () => {
  it("rotates the secret when the current one is proven", async () => {
    const res = createMockResponse();
    await handler(rotateRequest({ botKeyId: "botkey-1", secret: "old-secret" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ botKeyId: "botkey-1", secret: "new-secret-hex" });
    expect(updateBotKeyMock).toHaveBeenCalledWith({
      where: { id: "botkey-1" },
      data: { keyHash: "hashed:new-secret-hex" },
    });
  });

  it("rejects a wrong current secret without rotating", async () => {
    verifyBotKeySecretMock.mockReturnValue(false);
    const res = createMockResponse();
    await handler(rotateRequest({ botKeyId: "botkey-1", secret: "wrong" }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(updateBotKeyMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown botKeyId", async () => {
    (findBotKeyMock as any).mockResolvedValue(null);
    const res = createMockResponse();
    await handler(rotateRequest({ botKeyId: "nope", secret: "old-secret" }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("requires botKeyId and secret", async () => {
    const res = createMockResponse();
    await handler(rotateRequest({ botKeyId: "botkey-1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
