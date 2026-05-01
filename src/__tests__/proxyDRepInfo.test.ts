import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse, makeBearerAuth, makeBotJwtPayload } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string) => boolean>();
const verifyJwtMock: jest.Mock = jest.fn();
const isBotJwtMock: jest.Mock = jest.fn();
const authorizeProxyReadForV1Mock: jest.Mock = jest.fn();
const loadActiveProxyForWalletMock: jest.Mock = jest.fn();
const deriveProxyScriptsMock: jest.Mock = jest.fn();

const proxy = {
  id: "proxy-1",
  walletId: "wallet-1",
  proxyAddress: "addr_test_proxy",
  authTokenId: "policy",
  paramUtxo: JSON.stringify({ txHash: "aa", outputIndex: 0 }),
  isActive: true,
};

jest.mock("@/env", () => ({
  __esModule: true,
  env: { BLOCKFROST_API_KEY_PREPROD: "preprod-key" },
}), { virtual: true });

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}), { virtual: true });

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  applyBotRateLimit: applyBotRateLimitMock,
}), { virtual: true });

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: verifyJwtMock,
  isBotJwt: isBotJwtMock,
}), { virtual: true });

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {},
}), { virtual: true });

jest.mock("@/lib/server/proxyAccess", () => ({
  __esModule: true,
  authorizeProxyReadForV1: authorizeProxyReadForV1Mock,
  loadActiveProxyForWallet: loadActiveProxyForWalletMock,
}), { virtual: true });

jest.mock("@/lib/server/proxyTxBuilders", () => ({
  __esModule: true,
  deriveProxyScripts: deriveProxyScriptsMock,
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/proxyDRepInfo"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue(makeBotJwtPayload());
  isBotJwtMock.mockReturnValue(true);
  (authorizeProxyReadForV1Mock as any).mockResolvedValue({ wallet: { id: "wallet-1" } });
  (loadActiveProxyForWalletMock as any).mockResolvedValue(proxy);
  deriveProxyScriptsMock.mockReturnValue({
    authTokenId: proxy.authTokenId,
    proxyAddress: proxy.proxyAddress,
    dRepId: "drep1proxy",
  });
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ active: true }),
    text: async () => "",
  })) as never;
});

function infoRequest(query: Record<string, unknown> = {}): NextApiRequest {
  return {
    method: "GET",
    headers: makeBearerAuth(),
    query: {
      walletId: "wallet-1",
      address: makeBotJwtPayload().address,
      proxyId: proxy.id,
      ...query,
    },
  } as unknown as NextApiRequest;
}

describe("proxyDRepInfo API", () => {
  it("returns active proxy DRep status", async () => {
    const res = createMockResponse();

    await handler(infoRequest(), res);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://cardano-preprod.blockfrost.io/api/v0/governance/dreps/drep1proxy",
      { headers: { project_id: "preprod-key" } },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ active: true, dRepId: "drep1proxy" });
  });

  it("returns inactive when Blockfrost reports the DRep is not found", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => "not found",
    })) as never;
    const res = createMockResponse();

    await handler(infoRequest(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ active: false, dRepId: "drep1proxy" });
  });

  it("rejects unauthorized proxy reads", async () => {
    authorizeProxyReadForV1Mock.mockRejectedValueOnce(Object.assign(new Error("Not authorized for this wallet"), { code: "FORBIDDEN" }));
    const res = createMockResponse();

    await handler(infoRequest(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Not authorized for this wallet" });
  });

  it("rejects stored proxy metadata mismatches", async () => {
    deriveProxyScriptsMock.mockReturnValueOnce({
      authTokenId: "different-policy",
      proxyAddress: proxy.proxyAddress,
      dRepId: "drep1proxy",
    });
    const res = createMockResponse();

    await handler(infoRequest(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Stored proxy metadata does not match derived scripts" });
  });
});
