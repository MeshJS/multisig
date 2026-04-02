import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { BOT_TEST_ADDRESS, createMockResponse, makeBearerAuth, makeBotJwtPayload } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const verifyJwtMock: jest.Mock = jest.fn();
const createCallerMock: jest.Mock = jest.fn();
const buildMultisigWalletMock: jest.Mock = jest.fn();
const decodeNativeScriptFromCborMock: jest.Mock = jest.fn();
const decodedToNativeScriptMock: jest.Mock = jest.fn();

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
  decodeNativeScriptFromCbor: decodeNativeScriptFromCborMock,
  decodedToNativeScript: decodedToNativeScriptMock,
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
  decodeNativeScriptFromCborMock.mockImplementation((cbor) => ({ cbor }));
  decodedToNativeScriptMock.mockImplementation((decoded) => ({
    type: "decoded",
    cbor: (decoded as { cbor: string }).cbor,
  }));
  createCallerMock.mockReturnValue({
    wallet: {
      getWallet: (jest.fn() as any).mockResolvedValue({
        id: "wallet-1",
        scriptCbor: "canonical-payment-cbor",
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
    expect(res.json).toHaveBeenCalledWith([
      {
        type: "payment",
        script: { type: "decoded", cbor: "canonical-payment-cbor" },
      },
    ]);
    expect(buildMultisigWalletMock).not.toHaveBeenCalled();
  });

  it("returns payment and stake scripts from canonical sources", async () => {
    createCallerMock.mockReturnValue({
      wallet: {
        getWallet: (jest.fn() as any).mockResolvedValue({
          id: "wallet-1",
          scriptCbor: "canonical-payment-cbor",
          rawImportBodies: {
            multisig: {
              stake_script: "canonical-stake-cbor",
            },
          },
        }),
      },
    });

    const req = {
      method: "GET",
      headers: makeBearerAuth(),
      query: { walletId: "wallet-1", address: BOT_TEST_ADDRESS },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      {
        type: "payment",
        script: { type: "decoded", cbor: "canonical-payment-cbor" },
      },
      {
        type: "stake",
        script: { type: "decoded", cbor: "canonical-stake-cbor" },
      },
    ]);
    expect(buildMultisigWalletMock).not.toHaveBeenCalled();
  });

  it("falls back to sdk wallet reconstruction when canonical decode fails", async () => {
    decodeNativeScriptFromCborMock.mockImplementation(() => {
      throw new Error("decode failed");
    });

    const req = {
      method: "GET",
      headers: makeBearerAuth(),
      query: { walletId: "wallet-1", address: BOT_TEST_ADDRESS },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(buildMultisigWalletMock).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      { type: "payment", script: { type: "all", scripts: [] } },
    ]);
  });

  it("returns 500 when canonical scripts are unavailable and wallet cannot be constructed", async () => {
    decodeNativeScriptFromCborMock.mockImplementation(() => {
      throw new Error("decode failed");
    });
    createCallerMock.mockReturnValue({
      wallet: {
        getWallet: (jest.fn() as any).mockResolvedValue({
          id: "wallet-1",
          scriptCbor: "",
          rawImportBodies: null,
        }),
      },
    });
    buildMultisigWalletMock.mockReturnValue(undefined);

    const req = {
      method: "GET",
      headers: makeBearerAuth(),
      query: { walletId: "wallet-1", address: BOT_TEST_ADDRESS },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Wallet could not be constructed" });
  });
});
