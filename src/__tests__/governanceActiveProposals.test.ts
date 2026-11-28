import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

const addCorsCacheBustingHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string) => boolean>();
const applyAddressRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, address: string) => boolean>();
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
    applyAddressRateLimit: applyAddressRateLimitMock,
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
  applyAddressRateLimitMock.mockReturnValue(true);
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
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized - Missing or malformed Authorization header (expected: Bearer <token>)" });
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
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise the provider's actual non-Error rejection shape, including identity checks.
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
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise the provider's actual non-Error rejection shape, including identity checks.
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
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise the provider's actual non-Error rejection shape, including identity checks.
        throw {
          response: {
            status: 500,
            data: { status_code: 500 },
          },
        };
      }
      if (path === "/governance/proposals/tx-active/0/metadata") {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise the provider's actual non-Error rejection shape, including identity checks.
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
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise the provider's actual non-Error rejection shape, including identity checks.
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
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- Inspect the exact string coercion of the fetch argument supplied by this test.
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

  it("rejects out-of-bounds or malformed query params", async () => {
    const cases: Array<Record<string, string>> = [
      { count: "0" },
      { count: "-5" },
      { count: "101" },
      { count: "abc" },
      { page: "0" },
      { details: "maybe" },
      { includeRatified: "nah" },
    ];
    for (const query of cases) {
      const req = {
        method: "GET",
        headers: { authorization: "Bearer token" },
        query: { network: "1", ...query },
      } as unknown as NextApiRequest;
      const res = createMockResponse();
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  it("includes ratified proposals only when includeRatified=true and reports currentEpoch", async () => {
    providerGetMock.mockImplementation(async (path) => {
      if (path === "/epochs/latest") {
        return { epoch: 644 };
      }
      if (path.startsWith("/governance/proposals?")) {
        return [
          { tx_hash: "tx-active", cert_index: 0, governance_type: "info_action" },
          { tx_hash: "tx-ratified", cert_index: 1, governance_type: "treasury_withdrawals" },
        ];
      }
      if (path === "/governance/proposals/tx-active/0") {
        return { ratified_epoch: null, enacted_epoch: null, dropped_epoch: null, expired_epoch: null, expiration: 646 };
      }
      if (path === "/governance/proposals/tx-ratified/1") {
        return { ratified_epoch: 644, enacted_epoch: null, dropped_epoch: null, expired_epoch: null, expiration: 645 };
      }
      return null;
    });

    const baseReq = {
      method: "GET",
      headers: { authorization: "Bearer token" },
    };

    const resDefault = createMockResponse();
    await handler(
      { ...baseReq, query: { network: "1" } } as unknown as NextApiRequest,
      resDefault,
    );
    const bodyDefault = (resDefault.json as unknown as jest.Mock).mock.calls[0]?.[0] as any;
    expect(bodyDefault.proposals).toHaveLength(1);
    expect(bodyDefault.currentEpoch).toBe(644);
    expect(bodyDefault.includeRatified).toBe(false);

    const resRatified = createMockResponse();
    await handler(
      { ...baseReq, query: { network: "1", includeRatified: "true" } } as unknown as NextApiRequest,
      resRatified,
    );
    const bodyRatified = (resRatified.json as unknown as jest.Mock).mock.calls[0]?.[0] as any;
    expect(bodyRatified.proposals).toHaveLength(2);
    const statuses = bodyRatified.proposals.map((p: any) => p.status).sort();
    expect(statuses).toEqual(["active", "ratified"]);
  });

  describe("request scheduling", () => {
    // Each Blockfrost path answers through a promise the test settles by hand,
    // so a test can observe which requests are already out while others hang.
    type Deferred = {
      promise: Promise<unknown>;
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
    };
    const deferred = (): Deferred => {
      let resolve!: (value: unknown) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    const requestedPaths = () => providerGetMock.mock.calls.map(([path]) => path);
    const run = (query: Record<string, string> = {}) => {
      const res = createMockResponse();
      const done = handler(
        {
          method: "GET",
          headers: { authorization: "Bearer token" },
          query: { network: "1", ...query },
        } as unknown as NextApiRequest,
        res,
      );
      return { res, done };
    };
    const bodyOf = (res: ResponseMock) =>
      (res.json as unknown as jest.Mock).mock.calls[0]?.[0] as any;
    const openDetails = { ratified_epoch: null, enacted_epoch: null, dropped_epoch: null, expired_epoch: null };

    it("requests the proposal list without waiting for the current epoch", async () => {
      const epoch = deferred();
      providerGetMock.mockImplementation(async (path) => {
        if (path === "/epochs/latest") return epoch.promise;
        if (path.startsWith("/governance/proposals?")) return [];
        return null;
      });

      const { res, done } = run();
      await flush();

      expect(requestedPaths()).toContain("/governance/proposals?count=100&page=1&order=desc");
      expect(res.json).not.toHaveBeenCalled();

      epoch.resolve({ epoch: 700 });
      await done;

      expect(res.status).toHaveBeenCalledWith(200);
      expect(bodyOf(res).currentEpoch).toBe(700);
    });

    it("still answers with currentEpoch null when the epoch lookup fails", async () => {
      providerGetMock.mockImplementation(async (path) => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise the provider's actual non-Error rejection shape, including identity checks.
        if (path === "/epochs/latest") throw { status: 503, data: {} };
        if (path.startsWith("/governance/proposals?")) return [];
        return null;
      });

      const { res, done } = run();
      await done;

      expect(res.status).toHaveBeenCalledWith(200);
      expect(bodyOf(res).currentEpoch).toBeNull();
    });

    it("fetches one proposal's metadata while another proposal's details are still pending", async () => {
      const slowDetails = deferred();
      providerGetMock.mockImplementation(async (path) => {
        if (path === "/epochs/latest") return { epoch: 700 };
        if (path.startsWith("/governance/proposals?")) {
          return [
            { tx_hash: "tx-fast", cert_index: 0, governance_type: "info_action" },
            { tx_hash: "tx-slow", cert_index: 1, governance_type: "info_action" },
          ];
        }
        if (path === "/governance/proposals/tx-fast/0") return openDetails;
        if (path === "/governance/proposals/tx-slow/1") return slowDetails.promise;
        return null;
      });

      const { res, done } = run();
      await flush();

      expect(requestedPaths()).toContain("/governance/proposals/tx-fast/0/metadata");

      // The slow one turns out to be no longer active (this suite's status
      // stub reports any terminal epoch as "ratified", which the default
      // request leaves out), so its metadata is never requested.
      slowDetails.resolve({ ...openDetails, ratified_epoch: 650 });
      await done;

      expect(requestedPaths()).not.toContain("/governance/proposals/tx-slow/1/metadata");
      const body = bodyOf(res);
      expect(body.proposals.map((p: any) => p.proposalId)).toEqual(["tx-fast#0"]);
      expect(body.sourceCount).toBe(2);
      expect(body.activeCount).toBe(1);
    });

    const activeAndRatified = () =>
      providerGetMock.mockImplementation(async (path) => {
        if (path === "/epochs/latest") return { epoch: 700 };
        if (path.startsWith("/governance/proposals?")) {
          return [
            { tx_hash: "tx-active", cert_index: 0, governance_type: "info_action" },
            { tx_hash: "tx-ratified", cert_index: 1, governance_type: "info_action" },
          ];
        }
        if (path === "/governance/proposals/tx-active/0") return openDetails;
        if (path === "/governance/proposals/tx-ratified/1") return { ...openDetails, ratified_epoch: 699 };
        return null;
      });
    const metadataPaths = () => requestedPaths().filter((path) => path.endsWith("/metadata"));

    it("makes one request per epoch, list, proposal details and returned proposal's metadata — no more", async () => {
      activeAndRatified();

      const { done } = run();
      await done;

      expect(metadataPaths()).toEqual(["/governance/proposals/tx-active/0/metadata"]);
      // epoch + list + 2 details + 1 metadata
      expect(providerGetMock).toHaveBeenCalledTimes(5);
    });

    it("requests metadata for ratified proposals when includeRatified=true asks for them", async () => {
      activeAndRatified();

      const { done } = run({ includeRatified: "true" });
      await done;

      expect(metadataPaths().sort()).toEqual([
        "/governance/proposals/tx-active/0/metadata",
        "/governance/proposals/tx-ratified/1/metadata",
      ]);
    });

    it("answers 503 when the list is rate-limited, even while the epoch lookup is still out", async () => {
      const epoch = deferred();
      providerGetMock.mockImplementation(async (path) => {
        if (path === "/epochs/latest") return epoch.promise;
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise the provider's actual non-Error rejection shape, including identity checks.
        if (path.startsWith("/governance/proposals?")) throw { status: 429, data: {} };
        return null;
      });

      const { res, done } = run();
      await done;

      expect(res.status).toHaveBeenCalledWith(503);
      expect(bodyOf(res)).toEqual({
        error: "Governance provider rate-limited. Retry later.",
        retryable: true,
      });
      // The epoch lookup failing after the response is sent must be absorbed,
      // not surface as an unhandled rejection.
      epoch.reject({ status: 500, data: {} });
      await flush();
    });

    it("answers 500 when the list fails for another reason", async () => {
      providerGetMock.mockImplementation(async (path) => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise the provider's actual non-Error rejection shape, including identity checks.
        if (path === "/epochs/latest") throw { status: 500, data: {} };
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise the provider's actual non-Error rejection shape, including identity checks.
        if (path.startsWith("/governance/proposals?")) throw { status: 500, data: {} };
        return null;
      });

      const { res, done } = run();
      await done;

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it("keeps the list's order when a later proposal resolves first", async () => {
      const firstDetails = deferred();
      providerGetMock.mockImplementation(async (path) => {
        if (path === "/epochs/latest") return { epoch: 700 };
        if (path.startsWith("/governance/proposals?")) {
          return [
            { tx_hash: "tx-first", cert_index: 0, governance_type: "info_action" },
            { tx_hash: "tx-second", cert_index: 1, governance_type: "info_action" },
          ];
        }
        if (path === "/governance/proposals/tx-first/0") return firstDetails.promise;
        if (path === "/governance/proposals/tx-second/1") return openDetails;
        return null;
      });

      const { res, done } = run();
      await flush();
      firstDetails.resolve(openDetails);
      await done;

      expect(bodyOf(res).proposals.map((p: any) => p.proposalId)).toEqual([
        "tx-first#0",
        "tx-second#1",
      ]);
    });
  });

  describe("human (non-bot) callers", () => {
    const asHuman = () => {
      verifyJwtMock.mockReturnValue({ address: "addr_test1qphuman" });
      isBotJwtMock.mockReturnValue(false);
      providerGetMock.mockImplementation(async (path) =>
        path.startsWith("governance/proposals?") ? [] : null,
      );
    };

    const humanRequest = () =>
      ({
        method: "GET",
        headers: { authorization: "Bearer token" },
        query: { network: "1", count: "10", page: "1", order: "desc" },
      }) as unknown as NextApiRequest;

    it("allows a human JWT through — this is public chain data", async () => {
      asHuman();
      const res = createMockResponse();

      await handler(humanRequest(), res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("meters humans per address, not per bot", async () => {
      asHuman();
      const res = createMockResponse();

      await handler(humanRequest(), res);

      expect(applyAddressRateLimitMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "addr_test1qphuman",
      );
      // The bot budget must not be charged for a caller that has no bot id.
      expect(applyBotRateLimitMock).not.toHaveBeenCalled();
    });

    it("returns 429 when a human exceeds the address budget", async () => {
      asHuman();
      applyAddressRateLimitMock.mockReturnValue(false);
      const res = createMockResponse();

      await handler(humanRequest(), res);

      expect(res.status).not.toHaveBeenCalledWith(200);
    });

    it("still enforces the bot scope gate for bot callers", async () => {
      // The human path must not have opened a hole in the bot path.
      findBotUserMock.mockResolvedValue({
        id: "bot-1",
        botKey: { scope: JSON.stringify(["multisig:read"]) },
      });
      const res = createMockResponse();

      await handler(humanRequest(), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Insufficient scope: governance:read required",
      });
    });
  });
});
