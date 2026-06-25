import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

const addCorsCacheBustingHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string) => boolean>();
const verifyJwtMock = jest.fn<() => unknown>();
const isBotJwtMock = jest.fn<() => boolean>();
const findBotUserMock = jest.fn<() => Promise<unknown>>();
const getProviderMock = jest.fn();
const providerGetMock = jest.fn<(path: string) => Promise<unknown>>();
const parseScopeMock = jest.fn<(scope: string) => string[]>();
const scopeIncludesMock = jest.fn<(scopes: string[], required: string) => boolean>();
const getProposalStatusMock = jest.fn();

jest.unstable_mockModule(
  "@/lib/cors",
  () => ({
    __esModule: true,
    addCorsCacheBustingHeaders: addCorsCacheBustingHeadersMock,
    cors: corsMock,
  }),
);

jest.unstable_mockModule(
  "@/lib/security/requestGuards",
  () => ({
    __esModule: true,
    applyRateLimit: applyRateLimitMock,
    applyBotRateLimit: applyBotRateLimitMock,
  }),
);

jest.unstable_mockModule(
  "@/lib/verifyJwt",
  () => ({
    __esModule: true,
    verifyJwt: verifyJwtMock,
    isBotJwt: isBotJwtMock,
  }),
);

jest.unstable_mockModule(
  "@/lib/governance",
  () => ({
    __esModule: true,
    getProposalStatus: getProposalStatusMock,
  }),
);

jest.unstable_mockModule(
  "@/lib/auth/botKey",
  () => ({
    __esModule: true,
    parseScope: parseScopeMock,
    scopeIncludes: scopeIncludesMock,
  }),
);

jest.unstable_mockModule(
  "@/server/db",
  () => ({
    __esModule: true,
    db: {
      botUser: {
        findUnique: findBotUserMock,
      },
    },
  }),
);

jest.unstable_mockModule(
  "@/utils/get-provider",
  () => ({
    __esModule: true,
    getProvider: getProviderMock,
  }),
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
  getProviderMock.mockReturnValue({
    get: providerGetMock,
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
      if (path.startsWith("/governance/proposals?")) {
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
      if (path === "/governance/proposals/tx-active/0") {
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
      if (path === "/governance/proposals/tx-ratified/1") {
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
      if (path === "/governance/proposals/tx-active/0/metadata") {
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
    const payload = (res.json as unknown as jest.Mock).mock.calls[0]?.[0] as any;
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

  it("returns an empty proposal list when Blockfrost has no governance proposals", async () => {
    providerGetMock.mockImplementation(async (path) => {
      if (path.startsWith("/governance/proposals?")) {
        throw {
          response: {
            data: {
              error: "Not Found",
              message: "The requested component has not been found.",
              status_code: 404,
            },
          },
        };
      }
      return null;
    });

    const req = {
      method: "GET",
      headers: { authorization: "Bearer token" },
      query: { network: "0", count: "20", page: "1", order: "desc", details: "false" },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as unknown as jest.Mock).mock.calls[0]?.[0] as any;
    expect(payload).toMatchObject({
      proposals: [],
      activeCount: 0,
      sourceCount: 0,
      network: "0",
      details: false,
    });
  });

  it("still returns active proposals when optional details and metadata fetches fail", async () => {
    providerGetMock.mockImplementation(async (path) => {
      if (path.startsWith("/governance/proposals?")) {
        return [
          {
            tx_hash: "tx-active",
            cert_index: 0,
            governance_type: "info_action",
            enacted_epoch: null,
            dropped_epoch: null,
            expired_epoch: null,
            ratified_epoch: null,
          },
        ];
      }
      if (path === "/governance/proposals/tx-active/0") {
        throw {
          response: {
            status: 500,
            data: { status_code: 500 },
          },
        };
      }
      if (path === "/governance/proposals/tx-active/0/metadata") {
        throw {
          response: {
            status: 500,
            data: { status_code: 500 },
          },
        };
      }
      return null;
    });

    const req = {
      method: "GET",
      headers: { authorization: "Bearer token" },
      query: { network: "0", count: "20", page: "1", order: "desc", details: "false" },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as unknown as jest.Mock).mock.calls[0]?.[0] as any;
    expect(payload.proposals).toHaveLength(1);
    expect(payload.proposals[0]).toMatchObject({
      proposalId: "tx-active#0",
      title: null,
      status: "active",
    });
    expect(payload.activeCount).toBe(1);
  });

  it("falls back to direct Blockfrost REST when provider list fetch fails without a status", async () => {
    providerGetMock.mockImplementation(async (path) => {
      if (path.startsWith("/governance/proposals?")) {
        throw new Error("Internal Server Error");
      }
      if (path === "/governance/proposals/tx-active/0") {
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
      if (path === "/governance/proposals/tx-active/0/metadata") {
        throw { status: 404 };
      }
      return null;
    });
    const originalKey = process.env.BLOCKFROST_API_KEY_PREPROD;
    process.env.BLOCKFROST_API_KEY_PREPROD = "preprod-key";
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            tx_hash: "tx-active",
            cert_index: 0,
            governance_type: "info_action",
            enacted_epoch: null,
            dropped_epoch: null,
            expired_epoch: null,
            ratified_epoch: null,
          },
        ]),
        { status: 200 },
      ),
    );

    try {
      const req = {
        method: "GET",
        headers: { authorization: "Bearer token" },
        query: { network: "0", count: "20", page: "1", order: "desc", details: "false" },
      } as unknown as NextApiRequest;
      const res = createMockResponse();

      await handler(req, res);

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://cardano-preprod.blockfrost.io/api/v0/governance/proposals?count=20&page=1&order=desc",
        expect.objectContaining({
          headers: expect.objectContaining({ project_id: "preprod-key" }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      const payload = (res.json as unknown as jest.Mock).mock.calls[0]?.[0] as any;
      expect(payload.proposals).toHaveLength(1);
      expect(payload.activeCount).toBe(1);
    } finally {
      if (originalKey === undefined) {
        delete process.env.BLOCKFROST_API_KEY_PREPROD;
      } else {
        process.env.BLOCKFROST_API_KEY_PREPROD = originalKey;
      }
      fetchSpy.mockRestore();
    }
  });

  it("falls back to direct Blockfrost REST when provider construction fails", async () => {
    getProviderMock.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'slice')");
    });
    const originalKey = process.env.BLOCKFROST_API_KEY_PREPROD;
    process.env.BLOCKFROST_API_KEY_PREPROD = "preprod-key";
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes("/governance/proposals?")) {
        return new Response(
          JSON.stringify([
            {
              tx_hash: "tx-active",
              cert_index: 0,
              governance_type: "info_action",
              enacted_epoch: null,
              dropped_epoch: null,
              expired_epoch: null,
              ratified_epoch: null,
            },
          ]),
          { status: 200 },
        );
      }
      if (urlString.includes("/governance/proposals/tx-active/0/metadata")) {
        return new Response(JSON.stringify({ error: "Not Found", status_code: 404 }), {
          status: 404,
        });
      }
      if (urlString.includes("/governance/proposals/tx-active/0")) {
        return new Response(
          JSON.stringify({
            ratified_epoch: null,
            enacted_epoch: null,
            dropped_epoch: null,
            expired_epoch: null,
            expiration: 999,
            deposit: "1000000",
            return_address: "addr_test1...",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Unexpected path" }), { status: 500 });
    });

    try {
      const req = {
        method: "GET",
        headers: { authorization: "Bearer token" },
        query: { network: "0", count: "20", page: "1", order: "desc", details: "false" },
      } as unknown as NextApiRequest;
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = (res.json as unknown as jest.Mock).mock.calls[0]?.[0] as any;
      expect(payload.proposals).toHaveLength(1);
      expect(payload.activeCount).toBe(1);
    } finally {
      if (originalKey === undefined) {
        delete process.env.BLOCKFROST_API_KEY_PREPROD;
      } else {
        process.env.BLOCKFROST_API_KEY_PREPROD = originalKey;
      }
      fetchSpy.mockRestore();
    }
  });
});
