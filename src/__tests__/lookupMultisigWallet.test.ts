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
});
