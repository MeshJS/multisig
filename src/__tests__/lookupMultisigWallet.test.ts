import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const providerGetMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
}));

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: () => ({
    get: providerGetMock,
  }),
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

let resetLabel1854Cache: () => void;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/lookupMultisigWallet"));
  ({ resetLabel1854Cache } = await import("../lib/server/label1854Index"));
});

beforeEach(() => {
  jest.clearAllMocks();
  // The label sweep is cached per server instance; each test starts cold.
  resetLabel1854Cache();
  applyRateLimitMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
});

describe("lookupMultisigWallet API", () => {
  it("returns an empty result when metadata label 1854 is not found", async () => {
    (providerGetMock as any).mockRejectedValue({
      response: {
        data: {
          error: "Not Found",
          status_code: 404,
        },
      },
    });
    const req = {
      method: "GET",
      headers: {},
      query: {
        pubKeyHashes: "0123456789abcdef0123456789abcdef0123456789abcdef01234567",
        network: "0",
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it("pages through the label index and filters by participant hash", async () => {
    const targetHash =
      "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
    const otherHash =
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba98";
    const matching = {
      tx_hash: "a".repeat(64),
      json_metadata: {
        types: [0],
        name: "Match",
        participants: { [targetHash]: { name: "Alice" } },
      },
    };
    const nonMatching = {
      tx_hash: "b".repeat(64),
      json_metadata: {
        types: [0],
        participants: { [otherHash]: { name: "Bob" } },
      },
    };
    // Full first page (100 items) forces a second-page fetch; the match
    // living on page 2 verifies the handler paginates past page 1.
    const firstPage = Array.from({ length: 100 }, () => nonMatching);
    (providerGetMock as any)
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([matching]);

    const req = {
      method: "GET",
      headers: {},
      query: { pubKeyHashes: targetHash, network: "0" },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(providerGetMock).toHaveBeenCalledTimes(2);
    expect(providerGetMock).toHaveBeenNthCalledWith(
      1,
      "/metadata/txs/labels/1854?page=1&count=100",
    );
    expect(providerGetMock).toHaveBeenNthCalledWith(
      2,
      "/metadata/txs/labels/1854?page=2&count=100",
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([matching]);
  });

  it("stops after the first short page", async () => {
    (providerGetMock as any).mockResolvedValueOnce([]);
    const req = {
      method: "GET",
      headers: {},
      query: {
        pubKeyHashes: "0123456789abcdef0123456789abcdef0123456789abcdef01234567",
        network: "1",
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(providerGetMock).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([]);
  });
  it("serves concurrent lookups for different signers from one label sweep", async () => {
    const alice = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
    const bob = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba98";
    const aliceWallet = {
      tx_hash: "a".repeat(64),
      json_metadata: { participants: { [alice]: {} } },
    };
    const bobWallet = {
      tx_hash: "b".repeat(64),
      json_metadata: { participants: { [bob]: {} } },
    };
    const filler = {
      tx_hash: "c".repeat(64),
      json_metadata: { participants: { ["9".repeat(56)]: {} } },
    };
    // Three pages: two full, one short. Before the shared sweep, three
    // concurrent lookups cost 3 x 3 = 9 Blockfrost calls.
    (providerGetMock as any).mockImplementation(async (path: string) => {
      if (path.includes("page=1&")) return [aliceWallet, ...Array(99).fill(filler)];
      if (path.includes("page=2&")) return Array(100).fill(filler);
      return [bobWallet];
    });

    const lookup = async (pubKeyHashes: string) => {
      const res = createMockResponse();
      await handler(
        {
          method: "GET",
          headers: {},
          query: { pubKeyHashes, network: "0" },
        } as unknown as NextApiRequest,
        res,
      );
      return res;
    };

    const [forAlice, forBob, forBoth] = await Promise.all([
      lookup(alice),
      lookup(bob),
      lookup(`${alice},${bob}`),
    ]);

    expect(providerGetMock).toHaveBeenCalledTimes(3);
    expect(forAlice.json).toHaveBeenCalledWith([aliceWallet]);
    expect(forBob.json).toHaveBeenCalledWith([bobWallet]);
    expect(forBoth.json).toHaveBeenCalledWith([aliceWallet, bobWallet]);

    // A later lookup within the TTL costs no upstream calls at all.
    const again = await lookup(bob);
    expect(providerGetMock).toHaveBeenCalledTimes(3);
    expect(again.json).toHaveBeenCalledWith([bobWallet]);
  });

  it("keeps matches from earlier pages when a later page 404s", async () => {
    const targetHash =
      "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
    const matching = {
      tx_hash: "a".repeat(64),
      json_metadata: { participants: { [targetHash]: {} } },
    };
    (providerGetMock as any)
      .mockResolvedValueOnce([matching, ...Array(99).fill({ json_metadata: {} })])
      .mockRejectedValueOnce({ response: { data: { status_code: 404 } } });

    const res = createMockResponse();
    await handler(
      {
        method: "GET",
        headers: {},
        query: { pubKeyHashes: targetHash, network: "0" },
      } as unknown as NextApiRequest,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([matching]);
  });

  it("returns 500 and does not cache when Blockfrost fails", async () => {
    const targetHash =
      "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
    (providerGetMock as any)
      .mockRejectedValueOnce(new Error("Blockfrost 500"))
      .mockResolvedValueOnce([]);
    const req = {
      method: "GET",
      headers: {},
      query: { pubKeyHashes: targetHash, network: "0" },
    } as unknown as NextApiRequest;

    const failed = createMockResponse();
    await handler(req, failed);
    expect(failed.status).toHaveBeenCalledWith(500);

    const retried = createMockResponse();
    await handler(req, retried);
    expect(providerGetMock).toHaveBeenCalledTimes(2);
    expect(retried.status).toHaveBeenCalledWith(200);
    expect(retried.json).toHaveBeenCalledWith([]);
  });
  it("lets HTTP caches keep an answer only for what is left of the server TTL", async () => {
    const targetHash =
      "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
    (providerGetMock as any).mockResolvedValue([]);
    const req = {
      method: "GET",
      headers: {},
      query: { pubKeyHashes: targetHash, network: "0" },
    } as unknown as NextApiRequest;
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      const fresh = createMockResponse();
      await handler(req, fresh);
      expect(fresh.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        "public, max-age=60, stale-while-revalidate=120",
      );

      nowSpy.mockReturnValue(1_000_000 + 45_000);
      const later = createMockResponse();
      await handler(req, later);
      expect(later.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        "public, max-age=15, stale-while-revalidate=120",
      );
    } finally {
      nowSpy.mockRestore();
    }
  });
});
