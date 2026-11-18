import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";
import { BOT_ADDRESSES } from "./fixtures/botAddresses";

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
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyStrictRateLimit: applyStrictRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}));

jest.mock("@/lib/auth/botKey", () => ({
  __esModule: true,
  verifyBotKeySecret: verifyBotKeySecretMock,
  parseScope: parseScopeMock,
  scopeIncludes: scopeIncludesMock,
}));

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
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

beforeAll(async () => {
  process.env.JWT_SECRET = "x".repeat(32);
  ({ default: handler } = await import("../pages/api/v1/botAuth"));
});

const BOUND_ADDRESS = BOT_ADDRESSES.base;
const OTHER_ADDRESS = BOT_ADDRESSES.otherBase;

const boundBotUser: {
  id: string;
  botKeyId: string;
  paymentAddress: string;
  stakeAddress: string | null;
} = {
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

  describe("the bound address must be a real key-based Cardano address", () => {
    it.each([
      ["a placeholder string", "addr_test1qpbot00000000000000000000000000000000000"],
      ["a script address", BOT_ADDRESSES.enterpriseScript],
      ["a stake address", BOT_ADDRESSES.stake],
      ["the upper-case spelling", BOUND_ADDRESS.toUpperCase()],
    ])("first auth with %s is a 400 and binds nothing", async (_label, paymentAddress) => {
      const res = createMockResponse();

      await handler(authRequest({ paymentAddress }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Invalid paymentAddress" }),
      );
      expect(createBotUserMock).not.toHaveBeenCalled();
      expect(signMock).not.toHaveBeenCalled();
    });

    it("a bot bound before this check keeps authenticating when it sends its bound address", async () => {
      const legacyAddress = "addr_test1qpbot00000000000000000000000000000000000";
      mockBotUsers({ forKey: { ...boundBotUser, paymentAddress: legacyAddress } });
      const res = createMockResponse();

      await handler(authRequest({ paymentAddress: legacyAddress }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(createBotUserMock).not.toHaveBeenCalled();
    });

    it("a bot bound before this check keeps authenticating without an address", async () => {
      const legacy = { ...boundBotUser, paymentAddress: "addr_test1qpbot00000000000000000000000000000000000" };
      mockBotUsers({ forKey: legacy });
      const res = createMockResponse();

      await handler(authRequest({}), res);

      expect(res.status).toHaveBeenCalledWith(200);
      const jwtPayload = (signMock.mock.calls[0] as unknown[])[0] as { address: string };
      expect(jwtPayload.address).toBe(legacy.paymentAddress);
    });
  });

  describe("stakeAddress", () => {
    it("first auth stores a valid stake address on the same network", async () => {
      const res = createMockResponse();

      await handler(authRequest({ paymentAddress: BOUND_ADDRESS, stakeAddress: BOT_ADDRESSES.stake }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(createBotUserMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stakeAddress: BOT_ADDRESSES.stake }),
        }),
      );
    });

    it.each([
      ["a stake address on another network", BOT_ADDRESSES.stakeMainnet],
      ["a script stake address", BOT_ADDRESSES.stakeScript],
      ["a placeholder", "stake1_optional"],
    ])("first auth with %s is a 400 and binds nothing", async (_label, stakeAddress) => {
      const res = createMockResponse();

      await handler(authRequest({ paymentAddress: BOUND_ADDRESS, stakeAddress }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createBotUserMock).not.toHaveBeenCalled();
      expect(signMock).not.toHaveBeenCalled();
    });

    it("a later auth may update the stake address when it is valid", async () => {
      mockBotUsers({ forKey: boundBotUser });
      const res = createMockResponse();

      await handler(authRequest({ stakeAddress: BOT_ADDRESSES.stake }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(updateBotUserMock).toHaveBeenCalledWith({
        where: { id: "bot-user-id" },
        data: { stakeAddress: BOT_ADDRESSES.stake },
      });
    });

    it.each([
      ["one from the other network", BOT_ADDRESSES.stakeMainnet],
      ["the setup guide's old placeholder", "stake1_optional"],
    ])("a later auth ignores %s: the stored one stays and the bot still gets a token", async (_label, stakeAddress) => {
      mockBotUsers({ forKey: { ...boundBotUser, stakeAddress: BOT_ADDRESSES.stake } });
      const res = createMockResponse();

      await handler(authRequest({ stakeAddress }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(updateBotUserMock).not.toHaveBeenCalled();
    });

    it("a non-string stake address is ignored, as before", async () => {
      const res = createMockResponse();

      await handler(authRequest({ paymentAddress: BOUND_ADDRESS, stakeAddress: 42 }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(createBotUserMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stakeAddress: null }) }),
      );
    });

    it("an empty string means 'none', not an invalid address", async () => {
      const res = createMockResponse();

      await handler(authRequest({ paymentAddress: BOUND_ADDRESS, stakeAddress: "" }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(createBotUserMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stakeAddress: null }) }),
      );
    });
  });

  it("a concurrent first auth that loses the unique-index race is a 409, not a 500", async () => {
    const { Prisma } = await import("@prisma/client");
    (createBotUserMock as any).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    mockBotUsers({ forKey: null });
    const res = createMockResponse();

    await handler(authRequest({ paymentAddress: BOUND_ADDRESS }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(signMock).not.toHaveBeenCalled();
  });

  it("other database errors on bind still propagate", async () => {
    (createBotUserMock as any).mockRejectedValue(new Error("connection reset"));
    const res = createMockResponse();

    await expect(handler(authRequest({ paymentAddress: BOUND_ADDRESS }), res)).rejects.toThrow(
      "connection reset",
    );
  });
});
