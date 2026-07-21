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
const findBotUserMock: jest.Mock = jest.fn();
const createBotUserMock: jest.Mock = jest.fn();
const updateBotUserMock: jest.Mock = jest.fn();

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
  // botAuth.ts does `import jwt from "jsonwebtoken"; const { sign } = jwt`, so
  // the default export must carry `sign` (esModuleInterop reads `.default`).
  default: { sign: signMock },
  sign: signMock,
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    botKey: { findUnique: findBotKeyMock },
    botUser: {
      findUnique: findBotUserMock,
      create: createBotUserMock,
      update: updateBotUserMock,
    },
  },
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

beforeAll(async () => {
  process.env.JWT_SECRET = "x".repeat(32);
  ({ default: handler } = await import("../pages/api/v1/botAuth"));
});

const BOUND_ADDRESS = "addr_test1qpbot00000000000000000000000000000000000";
const OTHER_ADDRESS = "addr_test1qpother0000000000000000000000000000000";

const boundBotUser = {
  id: "bot-user-id",
  botKeyId: "bot-key-id",
  paymentAddress: BOUND_ADDRESS,
  stakeAddress: null,
};

function authRequest(body: Record<string, unknown>): NextApiRequest {
  return { method: "POST", body: { botKeyId: "bot-key-id", secret: "secret", ...body } } as unknown as NextApiRequest;
}

/** Route findUnique calls: by botKeyId → botUserForKey, by paymentAddress → botUserForAddress. */
function mockBotUsers({
  forKey,
  forAddress,
}: {
  forKey: typeof boundBotUser | null;
  forAddress?: typeof boundBotUser | null;
}) {
  (findBotUserMock as any).mockImplementation(async (args: any) => {
    if (args?.where?.botKeyId) return forKey;
    if (args?.where?.paymentAddress) return forAddress ?? null;
    return null;
  });
}

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
    name: "Test Bot",
    keyHash: "hashed",
    scope: JSON.stringify(["multisig:read"]),
  });
  mockBotUsers({ forKey: null });
  (createBotUserMock as any).mockImplementation(async (args: any) => ({ id: "bot-user-id", ...args.data }));
  (updateBotUserMock as any).mockImplementation(async (args: any) => ({ ...boundBotUser, ...args.data }));
});

describe("botAuth API", () => {
  it("returns 401 for invalid bot secret", async () => {
    verifyBotKeySecretMock.mockReturnValue(false);
    const res = createMockResponse();

    await handler(authRequest({ secret: "wrong", paymentAddress: BOUND_ADDRESS }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid bot key" });
  });

  it("first auth binds the supplied address and creates the BotUser", async () => {
    const res = createMockResponse();

    await handler(authRequest({ paymentAddress: BOUND_ADDRESS }), res);

    expect(createBotUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentAddress: BOUND_ADDRESS, displayName: "Test Bot" }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ token: "signed-jwt", botId: "bot-user-id" });
  });

  it("first auth without an address is a 400 (address is required to bind)", async () => {
    const res = createMockResponse();

    await handler(authRequest({}), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createBotUserMock).not.toHaveBeenCalled();
    expect(signMock).not.toHaveBeenCalled();
  });

  it("subsequent auth works without an address and uses the bound one", async () => {
    mockBotUsers({ forKey: boundBotUser });
    const res = createMockResponse();

    await handler(authRequest({}), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(createBotUserMock).not.toHaveBeenCalled();
    const jwtPayload = (signMock.mock.calls[0] as unknown[])[0] as { address: string };
    expect(jwtPayload.address).toBe(BOUND_ADDRESS);
  });

  it("subsequent auth accepts a matching address", async () => {
    mockBotUsers({ forKey: boundBotUser });
    const res = createMockResponse();

    await handler(authRequest({ paymentAddress: BOUND_ADDRESS }), res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rejects a mismatched address instead of rebinding the identity (P0)", async () => {
    mockBotUsers({ forKey: boundBotUser });
    const res = createMockResponse();

    await handler(authRequest({ paymentAddress: OTHER_ADDRESS }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(signMock).not.toHaveBeenCalled();
    expect(updateBotUserMock).not.toHaveBeenCalled();
    expect(createBotUserMock).not.toHaveBeenCalled();
  });

  it("rejects first-auth binding to an address owned by another bot", async () => {
    mockBotUsers({ forKey: null, forAddress: { ...boundBotUser, botKeyId: "someone-else" } });
    const res = createMockResponse();

    await handler(authRequest({ paymentAddress: BOUND_ADDRESS }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(createBotUserMock).not.toHaveBeenCalled();
    expect(signMock).not.toHaveBeenCalled();
  });
});
