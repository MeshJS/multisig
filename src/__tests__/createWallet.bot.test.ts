import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { BotWalletRole } from "@prisma/client";
import { createMockResponse, makeBearerAuth, makeBotJwtPayload } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string, limit?: number) => boolean>();
const enforceBodySizeMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, maxBytes: number) => boolean>();
const verifyJwtMock: jest.Mock = jest.fn();
const isBotJwtMock: jest.Mock = jest.fn();
const parseScopeMock: jest.Mock = jest.fn();
const scopeIncludesMock: jest.Mock = jest.fn();
const resolvePaymentKeyHashMock: jest.Mock = jest.fn();
const resolveStakeKeyHashMock: jest.Mock = jest.fn();
const serializeNativeScriptMock: jest.Mock = jest.fn();
const findBotUserMock: jest.Mock = jest.fn();
const createWalletMock: jest.Mock = jest.fn();
const upsertWalletAccessMock: jest.Mock = jest.fn();
const getScriptMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}), { virtual: true });

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  applyBotRateLimit: applyBotRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}), { virtual: true });

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: verifyJwtMock,
  isBotJwt: isBotJwtMock,
}), { virtual: true });

jest.mock("@/lib/auth/botKey", () => ({
  __esModule: true,
  parseScope: parseScopeMock,
  scopeIncludes: scopeIncludesMock,
}), { virtual: true });

jest.mock("@meshsdk/core", () => ({
  __esModule: true,
  resolvePaymentKeyHash: resolvePaymentKeyHashMock,
  resolveStakeKeyHash: resolveStakeKeyHashMock,
  serializeNativeScript: serializeNativeScriptMock,
}), { virtual: true });

jest.mock("@/utils/multisigSDK", () => ({
  __esModule: true,
  MultisigWallet: class {
    getScript() {
      return getScriptMock();
    }
  },
}), { virtual: true });

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    botUser: { findUnique: findBotUserMock },
    wallet: { create: createWalletMock },
    walletBotAccess: { upsert: upsertWalletAccessMock },
  },
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/createWallet"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue(makeBotJwtPayload());
  isBotJwtMock.mockReturnValue(true);
  parseScopeMock.mockReturnValue(["multisig:create", "multisig:read"]);
  scopeIncludesMock.mockReturnValue(true);
  resolvePaymentKeyHashMock.mockReturnValue("payment-hash");
  resolveStakeKeyHashMock.mockReturnValue("stake-hash");
  serializeNativeScriptMock.mockReturnValue({
    scriptCbor: "explicit-script-cbor",
    address: "addr_explicit_script",
  });
  getScriptMock.mockReturnValue({ scriptCbor: "script-cbor", address: "addr_wallet_script" });
  (findBotUserMock as any).mockResolvedValue({ id: "bot-test-id", botKey: { scope: JSON.stringify(["multisig:create"]) } });
  (createWalletMock as any).mockResolvedValue({ id: "wallet-1", name: "Bot Wallet" });
  (upsertWalletAccessMock as any).mockResolvedValue({ role: BotWalletRole.cosigner });
});

describe("createWallet bot API", () => {
  it("returns 400 for invalid signer address", async () => {
    resolvePaymentKeyHashMock.mockImplementation(() => {
      throw new Error("bad address");
    });
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        name: "Wallet",
        signersAddresses: ["invalid"],
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("creates wallet and bot access for valid bot payload", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        name: "Wallet",
        signersAddresses: ["addr_test1qpsigner0000000000000000000000000000000000"],
        signersDescriptions: ["Signer 1"],
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(createWalletMock).toHaveBeenCalled();
    expect(upsertWalletAccessMock).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ role: BotWalletRole.cosigner }),
    }));
    expect(serializeNativeScriptMock).toHaveBeenCalled();
    expect(getScriptMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      walletId: "wallet-1",
      address: "addr_explicit_script",
      name: "Bot Wallet",
    });
  });

  it("preserves signer input order for legacy payment script", async () => {
    resolvePaymentKeyHashMock
      .mockReturnValueOnce("hash-2")
      .mockReturnValueOnce("hash-1");
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        name: "Wallet",
        signersAddresses: [
          "addr_test1qpsigner0000000000000000000000000000000000",
          "addr_test1qpsigner1111111111111111111111111111111111",
        ],
        numRequiredSigners: 2,
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(serializeNativeScriptMock).toHaveBeenCalledWith(
      {
        type: "atLeast",
        required: 2,
        scripts: [
          { type: "sig", keyHash: "hash-2" },
          { type: "sig", keyHash: "hash-1" },
        ],
      },
      undefined,
      1,
      true,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("creates wallet from explicit payment native script", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        name: "Wallet",
        signersAddresses: ["addr_test1qpsigner0000000000000000000000000000000000"],
        scriptType: "all",
        paymentNativeScript: {
          type: "all",
          scripts: [
            {
              type: "atLeast",
              required: 1,
              scripts: [{ type: "sig", keyHash: "payment-hash" }],
            },
          ],
        },
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(serializeNativeScriptMock).toHaveBeenCalled();
    expect(getScriptMock).not.toHaveBeenCalled();
    expect(createWalletMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scriptCbor: "explicit-script-cbor",
          type: "all",
          numRequiredSigners: null,
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      walletId: "wallet-1",
      address: "addr_explicit_script",
      name: "Bot Wallet",
    });
  });

  it("derives type=all from explicit payment script root", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        name: "Wallet",
        signersAddresses: ["addr_test1qpsigner0000000000000000000000000000000000"],
        paymentNativeScript: {
          type: "all",
          scripts: [
            {
              type: "atLeast",
              required: 1,
              scripts: [{ type: "sig", keyHash: "payment-hash" }],
            },
          ],
        },
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(createWalletMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "all",
          numRequiredSigners: null,
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("accepts explicit hierarchical script with inner any", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        name: "Wallet",
        signersAddresses: [
          "addr_test1qpsigner0000000000000000000000000000000000",
          "addr_test1qpsigner1111111111111111111111111111111111",
        ],
        paymentNativeScript: {
          type: "all",
          scripts: [
            {
              type: "any",
              scripts: [
                { type: "sig", keyHash: "payment-hash" },
                { type: "sig", keyHash: "payment-hash" },
              ],
            },
          ],
        },
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("accepts explicit hierarchical script with inner all", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        name: "Wallet",
        signersAddresses: ["addr_test1qpsigner0000000000000000000000000000000000"],
        paymentNativeScript: {
          type: "all",
          scripts: [
            {
              type: "all",
              scripts: [{ type: "sig", keyHash: "payment-hash" }],
            },
          ],
        },
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 for malformed payment native script", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        name: "Wallet",
        signersAddresses: ["addr_test1qpsigner0000000000000000000000000000000000"],
        paymentNativeScript: {
          type: "all",
          scripts: [],
        },
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when explicit payment native script root is not all", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        name: "Wallet",
        signersAddresses: ["addr_test1qpsigner0000000000000000000000000000000000"],
        paymentNativeScript: {
          type: "atLeast",
          required: 1,
          scripts: [{ type: "sig", keyHash: "payment-hash" }],
        },
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when payment native script hashes do not match signers", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        name: "Wallet",
        signersAddresses: ["addr_test1qpsigner0000000000000000000000000000000000"],
        paymentNativeScript: {
          type: "all",
          scripts: [
            {
              type: "sig",
              keyHash: "other-hash",
            },
          ],
        },
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
