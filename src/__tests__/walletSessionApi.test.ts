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
const nonceDeleteMock: jest.Mock = jest.fn();
const getWalletSessionFromReqMock: jest.Mock = jest.fn();
const setWalletSessionCookieMock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}), { virtual: true });

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    nonce: {
      findFirst: nonceFindFirstMock,
      delete: nonceDeleteMock,
    },
  },
}), { virtual: true });

// DataSignature is a type-only use; stub the module so it never loads heavy WASM.
jest.mock("@meshsdk/core", () => ({ __esModule: true }), { virtual: true });

jest.mock("@meshsdk/core-cst", () => ({
  __esModule: true,
  checkSignature: checkSignatureMock,
}), { virtual: true });

// Identity normalize keeps these tests focused on status-code behavior; the real
// normalize is exercised by addressCompatibility's own coverage.
jest.mock("@/utils/addressCompatibility", () => ({
  __esModule: true,
  normalizeAddressToBech32: (a: string) => a,
}), { virtual: true });

jest.mock("@/lib/auth/walletSession", () => ({
  __esModule: true,
  getWalletSessionFromReq: getWalletSessionFromReqMock,
  setWalletSessionCookie: setWalletSessionCookieMock,
}), { virtual: true });

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
  (nonceDeleteMock as any).mockResolvedValue({});
  (checkSignatureMock as any).mockResolvedValue(true);
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
    expect(nonceDeleteMock).not.toHaveBeenCalled();
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
    expect(nonceDeleteMock).toHaveBeenCalledWith({ where: { id: "nonce-id" } });
    expect(setWalletSessionCookieMock).toHaveBeenCalled();
  });

  it("returns 500 only for genuine server faults (e.g. DB error)", async () => {
    (nonceFindFirstMock as any).mockRejectedValue(new Error("db down"));
    const res = createMockResponse();
    await handler(postRequest({ address: ADDRESS, signature: "ab", key: "cd" }), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
