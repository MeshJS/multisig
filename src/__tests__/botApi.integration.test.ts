import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { createMockResponse } from "./apiTestUtils";
import { hashBotKeySecret } from "../lib/auth/botKey";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}), { virtual: true });

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: () => true,
  applyBotRateLimit: () => true,
  applyStrictRateLimit: () => true,
  enforceBodySize: () => true,
}), { virtual: true });

jest.mock("@/env", () => ({
  __esModule: true,
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: "test",
  },
}), { virtual: true });

jest.mock("@meshsdk/core-cst", () => ({
  __esModule: true,
  checkSignature: async () => true,
}));

const runIntegration = process.env.RUN_BOT_API_INTEGRATION === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

let botAuthHandler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;
let botMeHandler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;
let addTransactionHandler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;
let submitDatumHandler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;
let db: any;

function firstJsonCall<T>(res: ReturnType<typeof createMockResponse>): T {
  return (res.json as unknown as jest.Mock).mock.calls[0]?.[0] as T;
}

describeIntegration("bot API integration smoke", () => {
  beforeAll(async () => {
    ({ db } = await import("../server/db"));
    ({ default: botAuthHandler } = await import("../pages/api/v1/botAuth"));
    ({ default: botMeHandler } = await import("../pages/api/v1/botMe"));
    ({ default: addTransactionHandler } = await import("../pages/api/v1/addTransaction"));
    ({ default: submitDatumHandler } = await import("../pages/api/v1/submitDatum"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    corsMock.mockResolvedValue(undefined);
  });

  it("authenticates bot and fetches bot profile", async () => {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
    const ownerAddress = `owner_${suffix}`;
    const paymentAddress = `addr_test1qpbotintegration${suffix}000000000000000000000000`;
    const secret = `secret-${suffix}`;

    const botKey = await db.botKey.create({
      data: {
        ownerAddress,
        name: `bot-${suffix}`,
        keyHash: hashBotKeySecret(secret),
        scope: JSON.stringify(["multisig:create", "multisig:read", "multisig:sign"]),
      },
    });

    const authReq = {
      method: "POST",
      body: { botKeyId: botKey.id, secret, paymentAddress },
    } as unknown as NextApiRequest;
    const authRes = createMockResponse();
    await botAuthHandler(authReq, authRes);
    expect(authRes.status).toHaveBeenCalledWith(200);
    const authBody = firstJsonCall<{ token: string; botId: string }>(authRes);
    expect(authBody.token).toBeTruthy();

    const meReq = {
      method: "GET",
      headers: { authorization: `Bearer ${authBody.token}` },
      query: {},
    } as unknown as NextApiRequest;
    const meRes = createMockResponse();
    await botMeHandler(meReq, meRes);
    expect(meRes.status).toHaveBeenCalledWith(200);
    await db.botUser.deleteMany({ where: { botKeyId: botKey.id } });
    await db.botKey.delete({ where: { id: botKey.id } });
  });

  it("runs mutating and signature-heavy bot routes against real db", async () => {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
    const paymentAddress = `addr_test1qpbotintegrationmut${suffix}000000000000000000000`;
    const secret = `secret-mut-${suffix}`;

    const botKey = await db.botKey.create({
      data: {
        ownerAddress: `owner_mut_${suffix}`,
        name: `bot-mut-${suffix}`,
        keyHash: hashBotKeySecret(secret),
        scope: JSON.stringify(["multisig:read", "multisig:sign"]),
      },
    });

    const wallet = await db.wallet.create({
      data: {
        name: `wallet-mut-${suffix}`,
        description: null,
        signersAddresses: [paymentAddress],
        signersStakeKeys: [],
        signersDRepKeys: [],
        signersDescriptions: [""],
        numRequiredSigners: 2,
        scriptCbor: "deadbeef",
        stakeCredentialHash: null,
        type: "atLeast",
        ownerAddress: "all",
      },
    });

    const authReq = {
      method: "POST",
      body: { botKeyId: botKey.id, secret, paymentAddress },
    } as unknown as NextApiRequest;
    const authRes = createMockResponse();
    await botAuthHandler(authReq, authRes);
    const authBody = firstJsonCall<{ token: string }>(authRes);

    const addReq = {
      method: "POST",
      headers: { authorization: `Bearer ${authBody.token}` },
      body: {
        walletId: wallet.id,
        address: paymentAddress,
        txCbor: "deadbeef",
        txJson: "{\"body\":{}}",
      },
    } as unknown as NextApiRequest;
    const addRes = createMockResponse();
    await addTransactionHandler(addReq, addRes);
    expect(addRes.status).toHaveBeenCalledWith(201);

    const submitReq = {
      method: "POST",
      headers: { authorization: `Bearer ${authBody.token}`, origin: "https://integration.test" },
      body: {
        walletId: wallet.id,
        signature: "sig",
        key: "key",
        address: paymentAddress,
        datum: "payload",
        callbackUrl: "https://integration.test/callback",
      },
    } as unknown as NextApiRequest;
    const submitRes = createMockResponse();
    await submitDatumHandler(submitReq, submitRes);
    expect(submitRes.status).toHaveBeenCalledWith(201);

    await db.transaction.deleteMany({ where: { walletId: wallet.id } });
    await db.signable.deleteMany({ where: { walletId: wallet.id } });
    await db.walletBotAccess.deleteMany({ where: { walletId: wallet.id } });
    await db.wallet.delete({ where: { id: wallet.id } });
    await db.botUser.deleteMany({ where: { botKeyId: botKey.id } });
    await db.botKey.delete({ where: { id: botKey.id } });
  });
});
