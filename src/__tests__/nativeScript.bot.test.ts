import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { BOT_TEST_ADDRESS, createMockResponse, makeBearerAuth, makeBotJwtPayload } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const verifyJwtMock: jest.Mock = jest.fn();
const createCallerMock: jest.Mock = jest.fn();
const buildMultisigWalletMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}), { virtual: true });

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
}), { virtual: true });

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: verifyJwtMock,
}), { virtual: true });

jest.mock("@/utils/common", () => ({
  __esModule: true,
  buildMultisigWallet: buildMultisigWalletMock,
}), { virtual: true });

jest.mock("@/server/api/root", () => ({
  __esModule: true,
  createCaller: createCallerMock,
}), { virtual: true });

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {},
}), { virtual: true });

jest.mock("@/lib/security/rateLimit", () => ({
  __esModule: true,
  getClientIP: () => "127.0.0.1",
}), { virtual: true });

jest.mock("@/utils/nativeScriptUtils", () => ({
  __esModule: true,
  decodeNativeScriptFromCbor: jest.fn(),
  decodedToNativeScript: jest.fn(),
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/nativeScript"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue(makeBotJwtPayload());
  createCallerMock.mockReturnValue({
    wallet: {
      getWallet: (jest.fn() as any).mockResolvedValue({
        id: "wallet-1",
        rawImportBodies: null,
      }),
    },
  });
  buildMultisigWalletMock.mockReturnValue({
    getAvailableTypes: () => ["payment"],
    buildScript: () => ({ type: "all", scripts: [] }),
  });
});

describe("nativeScript bot-runnable API", () => {
  it("returns 403 when address mismatches jwt address", async () => {
    const req = {
      method: "GET",
      headers: makeBearerAuth(),
      query: { walletId: "wallet-1", address: "addr_test1wrong" },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns native scripts for matching bot address", async () => {
    const req = {
      method: "GET",
      headers: makeBearerAuth(),
      query: { walletId: "wallet-1", address: BOT_TEST_ADDRESS },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([{ type: "payment", script: { type: "all", scripts: [] } }]);
  });
});
