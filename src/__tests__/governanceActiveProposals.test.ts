import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

const addCorsCacheBustingHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string) => boolean>();
const verifyJwtMock = jest.fn<() => unknown>();
const isBotJwtMock = jest.fn<() => boolean>();
const findBotUserMock = jest.fn<() => Promise<unknown>>();
const providerGetMock = jest.fn<(path: string) => Promise<unknown>>();
const parseScopeMock = jest.fn<(scope: string) => string[]>();
const scopeIncludesMock = jest.fn<(scopes: string[], required: string) => boolean>();
const getProposalStatusMock = jest.fn();

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
    getProposalStatus: getProposalStatusMock,
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
  "@/server/db",
  () => ({
    __esModule: true,
    db: {
      botUser: {
        findUnique: findBotUserMock,
      },
    },
  }),
  { virtual: true },
);

jest.mock(
  "@/utils/get-provider",
  () => ({
    __esModule: true,
    getProvider: () => ({
      get: providerGetMock,
    }),
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
  ({ default: handler } = await import("../pages/api/v1/governanceActiveProposals"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue({ address: "addr_test1", botId: "bot-1", type: "bot" });
  isBotJwtMock.mockReturnValue(true);
  parseScopeMock.mockImplementation((scope) => JSON.parse(scope) as string[]);
  scopeIncludesMock.mockImplementation((scopes, required) =>
    scopes.includes(required),
  );
  getProposalStatusMock.mockImplementation((details: any) => {
    if (details.enacted_epoch || details.dropped_epoch || details.expired_epoch || details.ratified_epoch) {
      return "ratified";
    }
    return "active";
  });
  findBotUserMock.mockResolvedValue({
    id: "bot-1",
    botKey: { scope: JSON.stringify(["multisig:read", "governance:read"]) },
  });
});

describe("governanceActiveProposals API", () => {
  it("returns 401 when token is missing", async () => {
    const req = { method: "GET", headers: {}, query: {} } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized - Missing token" });
  });

  it("returns only active proposals and tolerates metadata 404", async () => {
    providerGetMock.mockImplementation(async (path) => {
      if (path.startsWith("governance/proposals?")) {
        return [
          {
            tx_hash: "tx-active",
            cert_index: 0,
            governance_type: "hard_fork_initiation",
            enacted_epoch: null,
            dropped_epoch: null,
            expired_epoch: null,
            ratified_epoch: null,
          },
          {
            tx_hash: "tx-ratified",
            cert_index: 1,
            governance_type: "info_action",
            enacted_epoch: null,
            dropped_epoch: null,
            expired_epoch: null,
            ratified_epoch: 530,
          },
        ];
      }
      if (path === "governance/proposals/tx-active/0") {
        return {
          ratified_epoch: null,
          enacted_epoch: null,
          dropped_epoch: null,
          expired_epoch: null,
          expiration: 999,
          deposit: "1000000",
          return_address: "addr_test1...",
        };
      }
      if (path === "governance/proposals/tx-ratified/1") {
        return {
          ratified_epoch: 530,
          enacted_epoch: null,
          dropped_epoch: null,
          expired_epoch: null,
          expiration: 999,
          deposit: "1000000",
          return_address: "addr_test1...",
        };
      }
      if (path === "governance/proposals/tx-active/0/metadata") {
        throw JSON.stringify({
          data: {
            error: "Not Found",
            message: "The requested component has not been found.",
            status_code: 404,
          },
          status: 404,
        });
      }
      return null;
    });

    const req = {
      method: "GET",
      headers: { authorization: "Bearer token" },
      query: { network: "1", count: "100", page: "1", order: "desc" },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0]?.[0] as any;
    expect(Array.isArray(payload.proposals)).toBe(true);
    expect(payload.proposals).toHaveLength(1);
    expect(payload.proposals[0]).toMatchObject({
      proposalId: "tx-active#0",
      status: "active",
      title: null,
      abstract: null,
      motivation: null,
      rationale: null,
      authors: [],
    });
  });
});
