import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";

// The handler turned every thrown error into an opaque 500. These tests pin the
// new contract: 400 for bad input, 401 for an invalid OR throwing signature
// check, 200 for a valid one, and 500 reserved for genuine server faults.

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const checkSignatureMock: jest.Mock = jest.fn();
const nonceFindFirstMock: jest.Mock = jest.fn();
const nonceDeleteManyMock: jest.Mock = jest.fn();
const getWalletSessionFromReqMock: jest.Mock = jest.fn();
const setWalletSessionCookieMock = jest.fn();
const clearWalletSessionCookieMock = jest.fn();
const applyRateLimitMock = jest.fn<(...args: unknown[]) => boolean>();
const enforceBodySizeMock = jest.fn<(...args: unknown[]) => boolean>();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    nonce: {
      findFirst: nonceFindFirstMock,
      deleteMany: nonceDeleteManyMock,
    },
  },
}));

// DataSignature is a type-only use; stub the module so it never loads heavy WASM.
jest.mock("@meshsdk/core", () => ({ __esModule: true }));

jest.mock("@meshsdk/core-cst", () => ({
  __esModule: true,
  checkSignature: checkSignatureMock,
}));

// Identity normalize keeps these tests focused on status-code behavior; the real
// normalize is exercised by addressCompatibility's own coverage.
jest.mock("@/utils/addressCompatibility", () => ({
  __esModule: true,
  normalizeAddressToBech32: (a: string) => a,
}));

// The guards are stubbed so each test decides whether the request is within
// limits; the real limiter is covered by its own suite.
jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}));

jest.mock("@/env", () => ({
  __esModule: true,
  env: { JWT_SECRET: "x".repeat(32), NODE_ENV: "test" },
}));

// Cookie I/O is stubbed; the merge rule is the real one so these tests see
// exactly the wallet list a browser would receive.
jest.mock("@/lib/auth/walletSession", () => {
  const actual = jest.requireActual<typeof import("@/lib/auth/walletSession")>(
    "@/lib/auth/walletSession",
  );
  return {
    __esModule: true,
    addWalletToSession: actual.addWalletToSession,
    MAX_SESSION_WALLETS: actual.MAX_SESSION_WALLETS,
    getWalletSessionFromReq: getWalletSessionFromReqMock,
    setWalletSessionCookie: setWalletSessionCookieMock,
    clearWalletSessionCookie: clearWalletSessionCookieMock,
  };
});

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

const ADDRESS = "addr_test1qpwalletsessionfixture0000000000000000000000000000";

const postRequest = (body: unknown): NextApiRequest =>
  ({ method: "POST", body, cookies: {} } as unknown as NextApiRequest);

beforeAll(async () => {
  process.env.JWT_SECRET = "x".repeat(32);
  ({ default: handler } = await import("../pages/api/auth/wallet-session"));
});

beforeEach(() => {
  jest.clearAllMocks();
  corsMock.mockResolvedValue(undefined);
  getWalletSessionFromReqMock.mockReturnValue(null);
  (nonceFindFirstMock as any).mockResolvedValue({ id: "nonce-id", value: "deadbeef" });
  (nonceDeleteManyMock as any).mockResolvedValue({ count: 1 });
  (checkSignatureMock as any).mockResolvedValue(true);
  applyRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
});

describe("wallet-session API error handling", () => {
  it("returns 400 when address/signature/key are missing", async () => {
    const res = createMockResponse();
    await handler(postRequest({ address: ADDRESS }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(checkSignatureMock).not.toHaveBeenCalled();
  });

  it("returns 400 when no nonce has been issued", async () => {
    (nonceFindFirstMock as any).mockResolvedValue(null);
    const res = createMockResponse();
    await handler(postRequest({ address: ADDRESS, signature: "ab", key: "cd" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "No nonce issued for this address" });
  });

  it("returns 401 (NOT 500) when checkSignature THROWS (e.g. hex address / malformed COSE)", async () => {
    (checkSignatureMock as any).mockRejectedValue(
      new Error('Unknown letter "b". Allowed: qpzry9x8gf2tvdw0s3jn54khce6mua7l'),
    );
    const res = createMockResponse();
    await handler(postRequest({ address: ADDRESS, signature: "00", key: "00" }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid signature" });
    expect(nonceDeleteManyMock).not.toHaveBeenCalled();
  });

  it("returns 401 when checkSignature returns false", async () => {
    (checkSignatureMock as any).mockResolvedValue(false);
    const res = createMockResponse();
    await handler(postRequest({ address: ADDRESS, signature: "ab", key: "cd" }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid signature" });
  });

  it("returns 200 {ok:true} and consumes the nonce for a valid signature", async () => {
    const res = createMockResponse();
    await handler(postRequest({ address: ADDRESS, signature: "ab", key: "cd" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      wallets: [ADDRESS],
      primaryWallet: ADDRESS,
    });
    expect(nonceDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "nonce-id", value: "deadbeef" },
    });
    expect(setWalletSessionCookieMock).toHaveBeenCalled();
  });

  it("returns 401 and sets no session when the nonce was already spent or rotated", async () => {
    // A replay racing the original request, or getNonce rotating the value
    // between our read and our delete: the verified nonce is no longer there.
    (nonceDeleteManyMock as any).mockResolvedValue({ count: 0 });
    const res = createMockResponse();
    await handler(postRequest({ address: ADDRESS, signature: "ab", key: "cd" }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(setWalletSessionCookieMock).not.toHaveBeenCalled();
  });

  it("returns 500 only for genuine server faults (e.g. DB error)", async () => {
    (nonceFindFirstMock as any).mockRejectedValue(new Error("db down"));
    const res = createMockResponse();
    await handler(postRequest({ address: ADDRESS, signature: "ab", key: "cd" }), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("wallet-session API request guards", () => {
  it("rate-limits sign-in attempts per IP, the same budget as /api/v1/authSigner", async () => {
    const res = createMockResponse();
    await handler(postRequest({ address: ADDRESS, signature: "ab", key: "cd" }), res);

    expect(applyRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      res,
      { keySuffix: "auth/wallet-session", maxRequests: 20 },
    );
  });

  it("stops a rate-limited sign-in before any DB lookup or signature parsing", async () => {
    // applyRateLimit has already written the 429 when it returns false.
    applyRateLimitMock.mockReturnValue(false);
    const res = createMockResponse();
    await handler(postRequest({ address: ADDRESS, signature: "ab", key: "cd" }), res);

    expect(nonceFindFirstMock).not.toHaveBeenCalled();
    expect(checkSignatureMock).not.toHaveBeenCalled();
    expect(setWalletSessionCookieMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before any DB lookup or signature parsing", async () => {
    // enforceBodySize has already written the 413 when it returns false.
    enforceBodySizeMock.mockReturnValue(false);
    const res = createMockResponse();
    await handler(
      postRequest({ address: ADDRESS, signature: "ab".repeat(40_000), key: "cd" }),
      res,
    );

    expect(enforceBodySizeMock).toHaveBeenCalledWith(expect.anything(), res, 64 * 1024);
    expect(nonceFindFirstMock).not.toHaveBeenCalled();
    expect(checkSignatureMock).not.toHaveBeenCalled();
  });

  it("never throttles logout, so a rate-limited client can still sign out", async () => {
    applyRateLimitMock.mockReturnValue(false);
    const res = createMockResponse();
    await handler({ method: "DELETE", cookies: {} } as unknown as NextApiRequest, res);

    expect(applyRateLimitMock).not.toHaveBeenCalled();
    expect(clearWalletSessionCookieMock).toHaveBeenCalledWith(res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("wallet-session API session merge", () => {
  const OTHER = "addr_test1qpotherwalletfixture00000000000000000000000000000";

  it("adds the newly signed-in wallet to an existing session and makes it primary", async () => {
    getWalletSessionFromReqMock.mockReturnValue({ wallets: [OTHER], primaryWallet: OTHER });
    const res = createMockResponse();
    await handler(postRequest({ address: ADDRESS, signature: "ab", key: "cd" }), res);

    expect(setWalletSessionCookieMock).toHaveBeenCalledWith(res, {
      wallets: [OTHER, ADDRESS],
      primaryWallet: ADDRESS,
    });
  });

  it("caps the session at MAX_SESSION_WALLETS, evicting the least recently signed-in", async () => {
    const { MAX_SESSION_WALLETS } = await import("@/lib/auth/walletSession");
    const full = Array.from({ length: MAX_SESSION_WALLETS }, (_, i) => `addr_test1old${i}`);
    getWalletSessionFromReqMock.mockReturnValue({ wallets: full, primaryWallet: full[0] });
    const res = createMockResponse();
    await handler(postRequest({ address: ADDRESS, signature: "ab", key: "cd" }), res);

    const [, payload] = setWalletSessionCookieMock.mock.calls[0] as [unknown, { wallets: string[] }];
    expect(payload.wallets).toHaveLength(MAX_SESSION_WALLETS);
    expect(payload.wallets).not.toContain("addr_test1old0");
    expect(payload.wallets.at(-1)).toBe(ADDRESS);
  });
});
