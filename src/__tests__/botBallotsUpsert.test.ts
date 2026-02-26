import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

const addCorsCacheBustingHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string) => boolean>();
const enforceBodySizeMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, maxBytes: number) => boolean>();
const verifyJwtMock = jest.fn();
const isBotJwtMock = jest.fn();
const assertBotWalletAccessMock = jest.fn();
const findBotUserMock = jest.fn();
const transactionMock = jest.fn();
const parseScopeMock = jest.fn();
const scopeIncludesMock = jest.fn();
const isValidChoiceMock = jest.fn();
const parseProposalIdMock = jest.fn();

const txMock = {
  ballot: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
};

jest.mock(
  "@/lib/cors",
  () => ({
    __esModule: true,
    addCorsCacheBustingHeaders: addCorsCacheBustingHeadersMock,
    cors: corsMock,
  }),
  { virtual: true },
);

jest.mock(
  "@/lib/security/requestGuards",
  () => ({
    __esModule: true,
    applyRateLimit: applyRateLimitMock,
    applyBotRateLimit: applyBotRateLimitMock,
    enforceBodySize: enforceBodySizeMock,
  }),
  { virtual: true },
);

jest.mock(
  "@/lib/verifyJwt",
  () => ({
    __esModule: true,
    verifyJwt: verifyJwtMock,
    isBotJwt: isBotJwtMock,
  }),
  { virtual: true },
);

jest.mock(
  "@/lib/governance",
  () => ({
    __esModule: true,
    isValidChoice: isValidChoiceMock,
    parseProposalId: parseProposalIdMock,
  }),
  { virtual: true },
);

jest.mock(
  "@/lib/auth/botKey",
  () => ({
    __esModule: true,
    parseScope: parseScopeMock,
    scopeIncludes: scopeIncludesMock,
  }),
  { virtual: true },
);

jest.mock(
  "@/lib/auth/botAccess",
  () => ({
    __esModule: true,
    assertBotWalletAccess: assertBotWalletAccessMock,
  }),
  { virtual: true },
);

jest.mock(
  "@/server/db",
  () => ({
    __esModule: true,
    db: {
      botUser: {
        findUnique: findBotUserMock,
      },
      $transaction: transactionMock,
    },
  }),
  { virtual: true },
);

type ResponseMock = NextApiResponse & { statusCode?: number };

function createMockResponse(): ResponseMock {
  const res = {
    statusCode: undefined as number | undefined,
    status: jest.fn<(code: number) => NextApiResponse>(),
    json: jest.fn<(payload: unknown) => unknown>(),
    end: jest.fn<() => void>(),
    setHeader: jest.fn<(name: string, value: string) => void>(),
  };

  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res as unknown as NextApiResponse;
  });
  res.json.mockImplementation((payload: unknown) => payload);
  return res as unknown as ResponseMock;
}

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/botBallotsUpsert"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue({ address: "addr_test1", botId: "bot-1", type: "bot" });
  isBotJwtMock.mockReturnValue(true);
  parseScopeMock.mockImplementation((scope: string) => JSON.parse(scope));
  scopeIncludesMock.mockImplementation((scopes: string[], required: string) =>
    scopes.includes(required),
  );
  isValidChoiceMock.mockReturnValue(true);
  parseProposalIdMock.mockImplementation((value: string) => {
    const [txHash, certIndex] = value.split("#");
    return { txHash, certIndex: Number(certIndex) };
  });
  findBotUserMock.mockResolvedValue({
    id: "bot-1",
    botKey: { scope: JSON.stringify(["multisig:read", "ballot:write"]) },
  });
  assertBotWalletAccessMock.mockResolvedValue({ wallet: { id: "wallet-1" }, role: "cosigner" });
  transactionMock.mockImplementation(async (cb: any) => cb(txMock));
});

describe("botBallotsUpsert API", () => {
  it("rejects anchor fields in proposal payload", async () => {
    const req = {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: {
        walletId: "wallet-1",
        proposals: [
          {
            proposalId: "tx#0",
            proposalTitle: "Title",
            choice: "Yes",
            anchorUrl: "ipfs://should-not-be-allowed",
          },
        ],
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 409 when ballotName is ambiguous", async () => {
    txMock.ballot.findMany.mockResolvedValue([
      { id: "b1", walletId: "wallet-1", type: 1, description: "Gov", updatedAt: new Date() },
      { id: "b2", walletId: "wallet-1", type: 1, description: "Gov", updatedAt: new Date() },
    ]);

    const req = {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: {
        walletId: "wallet-1",
        ballotName: "Gov",
        proposals: [{ proposalId: "tx#0", proposalTitle: "Title", choice: "No" }],
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: "Multiple ballots match ballotName; provide ballotId to disambiguate",
    });
  });
});
