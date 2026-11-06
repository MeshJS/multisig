import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { createMockResponse } from "./apiTestUtils";

// POST /api/v1/authSigner used to have no error handling at all: a malformed
// COSE key or a hex CIP-30 address made checkSignature throw, and the throw
// surfaced as an opaque 500. Two requests replaying one signature both passed
// verification and the loser's delete crashed. These tests pin the contract:
// 400 bad input, 401 any signature that does not verify (thrown or false) or a
// nonce already spent, 200 a token, 500 only for real server faults.

const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const checkSignatureMock: jest.Mock = jest.fn();
const nonceFindFirstMock: jest.Mock = jest.fn();
const nonceDeleteManyMock: jest.Mock = jest.fn();
const botUserFindUniqueMock: jest.Mock = jest.fn();
const auditMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: jest.fn(),
  cors: corsMock,
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: () => true,
  enforceBodySize: () => true,
}));

jest.mock("@/lib/security/rateLimit", () => ({
  __esModule: true,
  getClientIP: () => "127.0.0.1",
}));

jest.mock("@/lib/observability/audit", () => ({
  __esModule: true,
  audit: auditMock,
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    nonce: {
      findFirst: nonceFindFirstMock,
      deleteMany: nonceDeleteManyMock,
    },
    botUser: { findUnique: botUserFindUniqueMock },
  },
}));

jest.mock("@meshsdk/core", () => ({
  __esModule: true,
  checkSignature: checkSignatureMock,
}));

const ADDRESS = "addr_test1qpauthsignerfixture00000000000000000000000000000";
const HEX_ADDRESS = "00" + "ab".repeat(56);

// Stand-in for the real hex→bech32 decoder (covered by addressCompatibility's
// own tests): maps the one hex fixture to ADDRESS and leaves bech32 untouched.
jest.mock("@/utils/addressCompatibility", () => ({
  __esModule: true,
  normalizeAddressToBech32: (a: string) => (a === HEX_ADDRESS ? ADDRESS : a),
}));

const JWT_SECRET = "s".repeat(32);

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

const postRequest = (body: unknown): NextApiRequest =>
  ({ method: "POST", body, headers: {} } as unknown as NextApiRequest);

const validBody = { address: ADDRESS, signature: "ab", key: "cd" };

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/authSigner"));
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = JWT_SECRET;
  corsMock.mockResolvedValue(undefined);
  (nonceFindFirstMock as any).mockResolvedValue({ id: "nonce-id", value: "deadbeef" });
  (nonceDeleteManyMock as any).mockResolvedValue({ count: 1 });
  (botUserFindUniqueMock as any).mockResolvedValue(null);
  (checkSignatureMock as any).mockResolvedValue(true);
  (auditMock as any).mockResolvedValue(undefined);
});

function issuedToken(res: ReturnType<typeof createMockResponse>) {
  const body = (res.json as jest.Mock).mock.calls[0]?.[0] as { token?: string };
  expect(typeof body?.token).toBe("string");
  return jwt.verify(body.token!, JWT_SECRET) as Record<string, unknown>;
}

describe("POST /api/v1/authSigner", () => {
  it("answers 405 for methods other than POST", async () => {
    const res = createMockResponse();
    await handler({ method: "GET", headers: {} } as unknown as NextApiRequest, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("answers 400 when address, signature or key is missing or not a string", async () => {
    for (const body of [undefined, {}, { address: ADDRESS }, { ...validBody, key: 7 }]) {
      const res = createMockResponse();
      await handler(postRequest(body), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(nonceFindFirstMock).not.toHaveBeenCalled();
  });

  it("answers 400 when no nonce was issued for the address", async () => {
    (nonceFindFirstMock as any).mockResolvedValue(null);
    const res = createMockResponse();
    await handler(postRequest(validBody), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "No nonce issued for this address" });
  });

  it("answers 401, not 500, when checkSignature throws on malformed input", async () => {
    (checkSignatureMock as any).mockRejectedValue(new Error("Invalid COSE_Key"));
    const res = createMockResponse();
    await handler(postRequest({ ...validBody, key: "not-cbor" }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid signature" });
    // The nonce survives so the caller can retry with a correct signature.
    expect(nonceDeleteManyMock).not.toHaveBeenCalled();
    // A thrown check is audited exactly like a failed one.
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "auth.sign_in.invalid_signature", outcome: "denied" }),
    );
  });

  it("answers 401 when the signature does not verify", async () => {
    (checkSignatureMock as any).mockResolvedValue(false);
    const res = createMockResponse();
    await handler(postRequest(validBody), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(nonceDeleteManyMock).not.toHaveBeenCalled();
  });

  it("issues a user token and consumes exactly the verified nonce", async () => {
    const res = createMockResponse();
    await handler(postRequest(validBody), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(nonceDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "nonce-id", value: "deadbeef" },
    });
    const claims = issuedToken(res);
    expect(claims.address).toBe(ADDRESS);
    expect(claims.botId).toBeUndefined();
  });

  it("issues a bot token when the address belongs to a bot", async () => {
    (botUserFindUniqueMock as any).mockResolvedValue({ id: "bot-1", paymentAddress: ADDRESS });
    const res = createMockResponse();
    await handler(postRequest(validBody), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(issuedToken(res)).toMatchObject({ address: ADDRESS, botId: "bot-1", type: "bot" });
  });

  it("answers 401 and issues no token when the nonce was spent or rotated mid-request", async () => {
    // A replay racing the original, or getNonce rotating the value between our
    // read and our delete: either way the nonce that was signed is gone.
    (nonceDeleteManyMock as any).mockResolvedValue({ count: 0 });
    const res = createMockResponse();
    await handler(postRequest(validBody), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.status).not.toHaveBeenCalledWith(200);
    expect(botUserFindUniqueMock).not.toHaveBeenCalled();
  });

  it("normalizes a hex CIP-30 address to bech32 before lookup, verification and the token", async () => {
    const res = createMockResponse();
    await handler(postRequest({ ...validBody, address: HEX_ADDRESS }), res);

    expect(nonceFindFirstMock).toHaveBeenCalledWith({ where: { address: ADDRESS } });
    expect(checkSignatureMock).toHaveBeenCalledWith("deadbeef", { signature: "ab", key: "cd" }, ADDRESS);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(issuedToken(res).address).toBe(ADDRESS);
  });

  it("answers 500 only for genuine server faults", async () => {
    (nonceFindFirstMock as any).mockRejectedValue(new Error("db down"));
    const res = createMockResponse();
    await handler(postRequest(validBody), res);
    expect(res.status).toHaveBeenCalledWith(500);

    (nonceFindFirstMock as any).mockResolvedValue({ id: "nonce-id", value: "deadbeef" });
    delete process.env.JWT_SECRET;
    const res2 = createMockResponse();
    await handler(postRequest(validBody), res2);
    expect(res2.status).toHaveBeenCalledWith(500);
    expect(res2.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
    // A missing secret must not spend the caller's nonce.
    expect(nonceDeleteManyMock).not.toHaveBeenCalled();
  });
});
