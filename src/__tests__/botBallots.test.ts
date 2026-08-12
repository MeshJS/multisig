import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<() => boolean>();
const applyBotRateLimitMock = jest.fn<() => boolean>();
const enforceBodySizeMock = jest.fn<() => boolean>();
const verifyJwtMock: jest.Mock = jest.fn();
const isBotJwtMock: jest.Mock = jest.fn();
const assertBotWalletAccessMock: jest.Mock = jest.fn();
const findBotUserMock: jest.Mock = jest.fn();
const ballotFindManyMock: jest.Mock = jest.fn();
const ballotFindUniqueMock: jest.Mock = jest.fn();
const ballotDeleteMock: jest.Mock = jest.fn();

class BotAccessErrorMock extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

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

jest.mock("@/lib/auth/botKey", () => ({
  __esModule: true,
  parseScope: (scope: string) => JSON.parse(scope) as string[],
  scopeIncludes: (scopes: string[], required: string) => scopes.includes(required),
}));

jest.mock("@/lib/auth/botAccess", () => ({
  __esModule: true,
  BotAccessError: BotAccessErrorMock,
  assertBotWalletAccess: assertBotWalletAccessMock,
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    botUser: { findUnique: findBotUserMock },
    ballot: {
      findMany: ballotFindManyMock,
      findUnique: ballotFindUniqueMock,
      delete: ballotDeleteMock,
    },
  },
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/botBallots"));
});

const GOV_BALLOT = {
  id: "ballot-1",
  walletId: "wallet-1",
  description: "Advisory",
  type: 1,
  items: ["a".repeat(64) + "#0"],
  itemDescriptions: ["Title"],
  choices: ["Yes"],
  anchorUrls: [""],
  anchorHashes: [""],
  rationaleComments: ["because"],
  createdAt: new Date("2026-07-21T00:00:00Z"),
  updatedAt: new Date("2026-07-21T00:00:00Z"),
};

function request(method: "GET" | "DELETE", opts: { query?: object; body?: object } = {}): NextApiRequest {
  return {
    method,
    headers: { authorization: "Bearer token" },
    query: opts.query ?? {},
    body: opts.body ?? {},
  } as unknown as NextApiRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue({ address: "addr_bot", botId: "bot-1", type: "bot" });
  isBotJwtMock.mockReturnValue(true);
  (findBotUserMock as any).mockResolvedValue({
    id: "bot-1",
    botKey: { scope: JSON.stringify(["ballot:write"]) },
  });
  (assertBotWalletAccessMock as any).mockResolvedValue({
    wallet: { id: "wallet-1", signersAddresses: [] },
    role: "observer",
  });
  (ballotFindManyMock as any).mockResolvedValue([GOV_BALLOT]);
  (ballotFindUniqueMock as any).mockResolvedValue(GOV_BALLOT);
  (ballotDeleteMock as any).mockResolvedValue(GOV_BALLOT);
});

describe("botBallots API", () => {
  it("lists governance ballots for a granted wallet (observer role)", async () => {
    const res = createMockResponse();
    await handler(request("GET", { query: { walletId: "wallet-1" } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0]?.[0] as { ballots: Array<{ id: string }> };
    expect(body.ballots).toHaveLength(1);
    expect(body.ballots[0]?.id).toBe("ballot-1");
    expect(ballotFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { walletId: "wallet-1", type: 1 } }),
    );
  });

  it("maps unknown wallet to 404", async () => {
    (assertBotWalletAccessMock as any).mockRejectedValue(new BotAccessErrorMock(404, "Wallet not found"));
    const res = createMockResponse();
    await handler(request("GET", { query: { walletId: "nope" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("requires ballot:write scope", async () => {
    (findBotUserMock as any).mockResolvedValue({
      id: "bot-1",
      botKey: { scope: JSON.stringify(["multisig:read"]) },
    });
    const res = createMockResponse();
    await handler(request("GET", { query: { walletId: "wallet-1" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("deletes a governance ballot on the granted wallet", async () => {
    const res = createMockResponse();
    await handler(request("DELETE", { body: { walletId: "wallet-1", ballotId: "ballot-1" } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ deleted: true, ballotId: "ballot-1" });
    expect(ballotDeleteMock).toHaveBeenCalledWith({ where: { id: "ballot-1" } });
  });

  it("refuses to delete a ballot belonging to another wallet", async () => {
    (ballotFindUniqueMock as any).mockResolvedValue({ ...GOV_BALLOT, walletId: "other-wallet" });
    const res = createMockResponse();
    await handler(request("DELETE", { body: { walletId: "wallet-1", ballotId: "ballot-1" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ballotDeleteMock).not.toHaveBeenCalled();
  });

  it("404s a nonexistent ballot on delete", async () => {
    (ballotFindUniqueMock as any).mockResolvedValue(null);
    const res = createMockResponse();
    await handler(request("DELETE", { body: { walletId: "wallet-1", ballotId: "gone" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
