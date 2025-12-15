import { TRPCError } from "@trpc/server";

import { applyRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { createCaller } from "@/server/api/root";

const mockRes = () => {
  const res: any = { statusCode: 200, body: null };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (val: unknown) => {
    res.body = val;
    return res;
  };
  return res;
};

const buildReq = (ip: string, body: unknown = {}) =>
  ({
    headers: { "x-real-ip": ip },
    socket: { remoteAddress: ip },
    body,
  } as any);

describe("request guards", () => {
  it("enforces rate limit and returns 429 when exceeded", () => {
    const req = buildReq("1.1.1.1");
    const res = mockRes();

    expect(applyRateLimit(req, res, { maxRequests: 2, windowMs: 10, keySuffix: "test" })).toBe(
      true,
    );
    expect(applyRateLimit(req, res, { maxRequests: 2, windowMs: 10, keySuffix: "test" })).toBe(
      true,
    );
    expect(applyRateLimit(req, res, { maxRequests: 2, windowMs: 10, keySuffix: "test" })).toBe(
      false,
    );
    expect(res.statusCode).toBe(429);
  });

  it("rejects oversized bodies with 413", () => {
    const large = "x".repeat(5 * 1024 * 1024);
    const res = mockRes();
    const req = buildReq("2.2.2.2", { large });
    expect(enforceBodySize(req, res, 1024)).toBe(false);
    expect(res.statusCode).toBe(413);
  });
});

describe("wallet router authorization", () => {
  const baseDb = {
    wallet: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    newWallet: { findUnique: jest.fn() },
    proxy: { findMany: jest.fn(), findUnique: jest.fn() },
    migration: { findUnique: jest.fn(), findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws UNAUTHORIZED when session is missing", async () => {
    const caller = createCaller({
      db: baseDb as any,
      session: null,
      sessionAddress: null,
      ip: "3.3.3.3",
    });

    await expect(
      caller.wallet.getWallet({ walletId: "w1", address: "addr1" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("throws FORBIDDEN when caller is not a signer", async () => {
    baseDb.wallet.findUnique.mockResolvedValueOnce({
      id: "w1",
      signersAddresses: ["other"],
      ownerAddress: "other",
      description: "",
      name: "",
      signersDescriptions: [],
      signersStakeKeys: [],
      signersDRepKeys: [],
      numRequiredSigners: 1,
      scriptCbor: "",
      type: "atLeast",
      stakeCredentialHash: null,
      rawImportBodies: null,
      isArchived: false,
      verified: [],
      migrationTargetWalletId: null,
    });

    const caller = createCaller({
      db: baseDb as any,
      session: { user: { id: "addr1" }, expires: new Date().toISOString() } as any,
      sessionAddress: "addr1",
      ip: "4.4.4.4",
    });

    await expect(
      caller.wallet.getWallet({ walletId: "w1", address: "addr1" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("returns wallet when caller is a signer", async () => {
    const wallet = {
      id: "w1",
      signersAddresses: ["addr1"],
      ownerAddress: "addr1",
      description: "",
      name: "Wallet",
      signersDescriptions: [],
      signersStakeKeys: [],
      signersDRepKeys: [],
      numRequiredSigners: 1,
      scriptCbor: "",
      type: "atLeast",
      stakeCredentialHash: null,
      rawImportBodies: null,
      isArchived: false,
      verified: [],
      migrationTargetWalletId: null,
    };
    baseDb.wallet.findUnique.mockResolvedValueOnce(wallet);

    const caller = createCaller({
      db: baseDb as any,
      session: { user: { id: "addr1" }, expires: new Date().toISOString() } as any,
      sessionAddress: "addr1",
      ip: "5.5.5.5",
    });

    const result = await caller.wallet.getWallet({ walletId: "w1", address: "addr1" });
    expect(result).toEqual(wallet);
  });
});

