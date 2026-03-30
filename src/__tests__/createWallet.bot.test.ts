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
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      walletId: "wallet-1",
      address: "addr_wallet_script",
      name: "Bot Wallet",
    });
  });
});
