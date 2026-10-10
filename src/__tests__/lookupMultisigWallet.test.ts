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

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/lookupMultisigWallet"));
});

beforeEach(() => {
  jest.clearAllMocks();
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
});
