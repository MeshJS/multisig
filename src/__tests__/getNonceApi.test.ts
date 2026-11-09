import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";

// GET /api/v1/getNonce must key the nonce by the same address form that
// authSigner and wallet-session look it up by. Both normalize hex CIP-30
// addresses to bech32, so getNonce has to as well — otherwise a hex caller's
// nonce is stored under a key nobody ever reads.

const nonceFindFirstMock: jest.Mock = jest.fn();
const nonceCreateMock: jest.Mock = jest.fn();
const nonceUpdateMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: jest.fn(),
  cors: jest.fn(async () => undefined),
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: () => true,
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    user: { findUnique: jest.fn(async () => null) },
    nonce: {
      findFirst: nonceFindFirstMock,
      create: nonceCreateMock,
      update: nonceUpdateMock,
    },
  },
}));

const ADDRESS = "addr_test1qpgetnoncefixture000000000000000000000000000000";
const HEX_ADDRESS = "00" + "cd".repeat(56);

jest.mock("@/utils/addressCompatibility", () => ({
  __esModule: true,
  normalizeAddressToBech32: (a: string) => (a === HEX_ADDRESS ? ADDRESS : a),
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

const getRequest = (query: Record<string, unknown>): NextApiRequest =>
  ({ method: "GET", query, headers: {} } as unknown as NextApiRequest);

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/getNonce"));
});

beforeEach(() => {
  jest.clearAllMocks();
  (nonceFindFirstMock as any).mockResolvedValue(null);
  (nonceCreateMock as any).mockResolvedValue({});
  (nonceUpdateMock as any).mockResolvedValue({});
});

describe("GET /api/v1/getNonce", () => {
  it("answers 400 without an address", async () => {
    const res = createMockResponse();
    await handler(getRequest({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("stores a hex address's nonce under its bech32 form", async () => {
    const res = createMockResponse();
    await handler(getRequest({ address: HEX_ADDRESS }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(nonceFindFirstMock).toHaveBeenCalledWith({ where: { address: ADDRESS } });
    expect(nonceCreateMock).toHaveBeenCalledWith({
      data: { address: ADDRESS, value: expect.stringMatching(/^[0-9a-f]{32}$/) },
    });
  });

  it("rotates the value of an existing nonce instead of reusing it", async () => {
    (nonceFindFirstMock as any).mockResolvedValue({ id: "n1", value: "old" });
    const res = createMockResponse();
    await handler(getRequest({ address: ADDRESS }), res);

    const update = (nonceUpdateMock.mock.calls[0]?.[0] ?? {}) as {
      where?: unknown;
      data?: { value?: string };
    };
    expect(update.where).toEqual({ id: "n1" });
    expect(update.data?.value).toMatch(/^[0-9a-f]{32}$/);
    expect(update.data?.value).not.toBe("old");
    expect(res.json).toHaveBeenCalledWith({ nonce: update.data?.value });
  });
});
