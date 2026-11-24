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
const assertBotWalletAccessMock: jest.Mock = jest.fn();
const botHasScopeMock: jest.Mock = jest.fn();
const checkSignatureMock: jest.Mock = jest.fn();
const createSignableMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  applyBotRateLimit: applyBotRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}));

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: verifyJwtMock,
  isBotJwt: isBotJwtMock,
}));

jest.mock("@/lib/auth/botAccess", () => ({
  BotAccessError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  botHasScope: botHasScopeMock,
  __esModule: true,
  assertBotWalletAccess: assertBotWalletAccessMock,
}));

jest.mock("@meshsdk/core-cst", () => ({
  __esModule: true,
  checkSignature: checkSignatureMock,
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    signable: { create: createSignableMock },
    wallet: { findUnique: jest.fn() },
  },
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;
let parseSubmitDatumBody: typeof import("../pages/api/v1/submitDatum").parseSubmitDatumBody;

beforeAll(async () => {
  ({ default: handler, parseSubmitDatumBody } = await import("../pages/api/v1/submitDatum"));
});

const validBody = () => ({
  walletId: "wallet-1",
  signature: "845846a201",
  key: "a40101",
  address: BOT_TEST_ADDRESS,
  datum: "payload",
  callbackUrl: "https://example.com/callback",
});

async function submit(body: unknown) {
  const req = {
    method: "POST",
    headers: makeBearerAuth(),
    body,
  } as unknown as NextApiRequest;
  const res = createMockResponse();
  await handler(req, res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  (botHasScopeMock as any).mockResolvedValue(true);
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue(makeBotJwtPayload());
  isBotJwtMock.mockReturnValue(true);
  (assertBotWalletAccessMock as any).mockResolvedValue({ wallet: { id: "wallet-1" } });
  (checkSignatureMock as any).mockResolvedValue(true);
  (createSignableMock as any).mockResolvedValue({ id: "sig-1" });
});

describe("submitDatum bot API", () => {
  it("rejects a scope-less bot with 403 before body validation runs", async () => {
    (botHasScopeMock as any).mockResolvedValue(false);
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      // Deliberately invalid body: the scope gate must fire first.
      body: {},
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Insufficient scope: multisig:sign required" });
    expect(assertBotWalletAccessMock).not.toHaveBeenCalled();
  });
  it("returns 401 for invalid datum signature", async () => {
    (checkSignatureMock as any).mockResolvedValue(false);
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        walletId: "wallet-1",
        signature: "845846a201",
        key: "a40101",
        address: BOT_TEST_ADDRESS,
        datum: "payload",
        callbackUrl: "https://example.com/callback",
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("creates signable datum for authorized bot", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        walletId: "wallet-1",
        signature: "845846a201",
        key: "a40101",
        address: BOT_TEST_ADDRESS,
        datum: "payload",
        callbackUrl: "https://example.com/callback",
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(createSignableMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: "sig-1" });
  });
});

describe("submitDatum request validation", () => {
  it("rejects a missing key with 400 instead of passing it to checkSignature", async () => {
    const { key: _key, ...body } = validBody();
    const res = await submit(body);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "key is required and must be hex" });
    expect(checkSignatureMock).not.toHaveBeenCalled();
  });

  it.each([
    ["walletId", 42],
    ["walletId", ["wallet-1"]],
    ["signature", "not-hex"],
    ["signature", { cbor: "84" }],
    ["key", "zz"],
    ["key", "a4010"],
    ["address", 1],
    ["datum", { fields: [] }],
    ["description", 7],
  ])("rejects %s = %j with 400 before any signature check or DB write", async (field, value) => {
    const res = await submit({ ...validBody(), [field]: value });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(checkSignatureMock).not.toHaveBeenCalled();
    expect(createSignableMock).not.toHaveBeenCalled();
  });

  it("answers 400, not 500, when the signature or key is not decodable COSE", async () => {
    (checkSignatureMock as any).mockRejectedValue(new RangeError("Trying to access beyond buffer length"));
    const res = await submit(validBody());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(createSignableMock).not.toHaveBeenCalled();
  });

  it("the real checkSignature throws on hex that is not COSE, which is why the handler catches it", async () => {
    const real = jest.requireActual<typeof import("@meshsdk/core-cst")>("@meshsdk/core-cst");
    await expect(
      real.checkSignature("payload", { signature: "abcd", key: "abcd" }, BOT_TEST_ADDRESS),
    ).rejects.toThrow();
  });

  it("accepts a request without callbackUrl, as the OpenAPI spec documents, and stores null", async () => {
    const { callbackUrl: _cb, ...body } = validBody();
    const res = await submit(body);
    expect(res.status).toHaveBeenCalledWith(201);
    const data = (createSignableMock.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.callbackUrl).toBeNull();
    expect(data.description).toBe("External Tx");
  });

  it.each(["javascript:alert(1)", "ftp://example.com/x", "not a url", `https://e.com/${"a".repeat(2048)}`])(
    "rejects callbackUrl %s",
    async (callbackUrl) => {
      const res = await submit({ ...validBody(), callbackUrl });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(createSignableMock).not.toHaveBeenCalled();
    },
  );

  it("still refuses a body address that is not the token's address", async () => {
    const res = await submit({ ...validBody(), address: "addr_test1someoneelse" });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(checkSignatureMock).not.toHaveBeenCalled();
  });

  it("parseSubmitDatumBody keeps a given description and callbackUrl", () => {
    const parsed = parseSubmitDatumBody({ ...validBody(), description: "Vote rationale" });
    expect(parsed).toEqual({
      ok: true,
      body: { ...validBody(), description: "Vote rationale" },
    });
  });

  it("parseSubmitDatumBody treats a null description or callbackUrl as absent", () => {
    const parsed = parseSubmitDatumBody({ ...validBody(), description: null, callbackUrl: null });
    expect(parsed.ok && parsed.body.description).toBe("External Tx");
    expect(parsed.ok && parsed.body.callbackUrl).toBeNull();
  });

  it("parseSubmitDatumBody rejects a missing body", () => {
    expect(parseSubmitDatumBody(undefined)).toEqual({ ok: false, error: "walletId is required" });
  });
});
