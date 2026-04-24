import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { BOT_TEST_ADDRESS, createMockResponse, makeBearerAuth, makeBotJwtPayload } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string) => boolean>();
const enforceBodySizeMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, maxBytes: number) => boolean>();
const verifyJwtMock: jest.Mock = jest.fn();
const isBotJwtMock: jest.Mock = jest.fn();
const getBotWalletAccessMock: jest.Mock = jest.fn();
const resolvePaymentKeyHashMock: jest.Mock = jest.fn();
const calculateTxHashMock: jest.Mock = jest.fn();
const createVkeyWitnessFromHexMock: jest.Mock = jest.fn();
const addUniqueVkeyWitnessToTxMock: jest.Mock = jest.fn();
const shouldSubmitMultisigTxMock: jest.Mock = jest.fn();
const submitTxWithScriptRecoveryMock: jest.Mock = jest.fn();
const findWalletMock: jest.Mock = jest.fn();
const findTransactionMock: jest.Mock = jest.fn();
const updateManyTransactionMock: jest.Mock = jest.fn();

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

jest.mock("@/lib/auth/botAccess", () => ({
  __esModule: true,
  getBotWalletAccess: getBotWalletAccessMock,
}), { virtual: true });

jest.mock("@meshsdk/core", () => ({
  __esModule: true,
  resolvePaymentKeyHash: resolvePaymentKeyHashMock,
}), { virtual: true });

jest.mock("@meshsdk/core-csl", () => ({
  __esModule: true,
  calculateTxHash: calculateTxHashMock,
}), { virtual: true });

jest.mock("@/utils/txSignUtils", () => ({
  __esModule: true,
  createVkeyWitnessFromHex: createVkeyWitnessFromHexMock,
  addUniqueVkeyWitnessToTx: addUniqueVkeyWitnessToTxMock,
  shouldSubmitMultisigTx: shouldSubmitMultisigTxMock,
  submitTxWithScriptRecovery: submitTxWithScriptRecoveryMock,
}), { virtual: true });

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: () => ({ submitTx: jest.fn() }),
}), { virtual: true });

jest.mock("@/utils/multisigSDK", () => ({
  __esModule: true,
  addressToNetwork: () => 0,
}), { virtual: true });

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    wallet: { findUnique: findWalletMock },
    transaction: {
      findUnique: findTransactionMock,
      updateMany: updateManyTransactionMock,
    },
  },
}), { virtual: true });

jest.mock("@/server/api/root", () => ({
  __esModule: true,
  createCaller: () => ({ wallet: { getWallet: jest.fn() } }),
}), { virtual: true });

jest.mock("@/lib/security/rateLimit", () => ({
  __esModule: true,
  getClientIP: () => "127.0.0.1",
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

function makeWitnessRecord() {
  return {
    vkey: () => ({
      public_key: () => ({
        hash: () => ({ to_bytes: () => Buffer.from("a1b2c3d4", "hex") }),
        to_bech32: () => "bech32",
      }),
    }),
    signature: () => ({ to_bytes: () => Buffer.from("ff", "hex") }),
  };
}

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/signTransaction"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue(makeBotJwtPayload());
  isBotJwtMock.mockReturnValue(true);
  (getBotWalletAccessMock as any).mockResolvedValue({ allowed: true, role: "cosigner" });
  (findWalletMock as any).mockResolvedValue({
    id: "wallet-1",
    signersAddresses: [BOT_TEST_ADDRESS],
    numRequiredSigners: 2,
    type: "atLeast",
  });
  (findTransactionMock as any)
    .mockResolvedValueOnce({
      id: "tx-1",
      walletId: "wallet-1",
      state: 0,
      signedAddresses: [],
      rejectedAddresses: [],
      txCbor: "deadbeef",
      txJson: "{}",
      txHash: null,
    })
    .mockResolvedValueOnce({
      id: "tx-1",
      state: 0,
      signedAddresses: [BOT_TEST_ADDRESS],
      rejectedAddresses: [],
      txCbor: "deadbeef-merged",
      txJson: "{\"multisig\":{\"state\":0}}",
      txHash: null,
    });
  resolvePaymentKeyHashMock.mockReturnValue("a1b2c3d4");
  calculateTxHashMock.mockReturnValue("ff".repeat(32));
  createVkeyWitnessFromHexMock.mockReturnValue({
    publicKey: { verify: () => true },
    signature: {},
    witness: {},
    keyHashHex: "a1b2c3d4",
  });
  addUniqueVkeyWitnessToTxMock.mockReturnValue({
    txHex: "deadbeef-merged",
    witnessAdded: true,
    vkeyWitnesses: { len: () => 1, get: () => makeWitnessRecord() },
  });
  shouldSubmitMultisigTxMock.mockReturnValue(false);
  (submitTxWithScriptRecoveryMock as any).mockResolvedValue({
    txHash: "hash",
    txHex: "deadbeef-merged",
  });
  (updateManyTransactionMock as any).mockResolvedValue({ count: 1 });
});

describe("signTransaction bot API", () => {
  it("returns 403 when bot is not cosigner", async () => {
    (getBotWalletAccessMock as any).mockResolvedValue({ allowed: true, role: "observer" });
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        walletId: "wallet-1",
        transactionId: "tx-1",
        address: BOT_TEST_ADDRESS,
        signature: "aa".repeat(64),
        key: "bb".repeat(64),
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("records bot witness on happy path", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        walletId: "wallet-1",
        transactionId: "tx-1",
        address: BOT_TEST_ADDRESS,
        signature: "aa".repeat(64),
        key: "bb".repeat(64),
        broadcast: false,
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(updateManyTransactionMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      submitted: false,
    }));
  });
});
