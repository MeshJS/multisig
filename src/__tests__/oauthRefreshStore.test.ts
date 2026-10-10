import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Unit tests for the database-backed refresh-token store.
 *
 * The endpoint tests in `oauthFlow.test.ts` mock this module, so the rotation
 * and replay-detection logic itself is covered here, against a mocked Prisma
 * surface. Nothing else in this file imports `@/server/db`, so the mock applies
 * to the one module under test.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyAsyncMock = jest.Mock<(...args: any[]) => any>;

const findUniqueMock = jest.fn() as AnyAsyncMock;
const updateManyMock = jest.fn() as AnyAsyncMock;
const createMock = jest.fn() as AnyAsyncMock;
const updateMock = jest.fn() as AnyAsyncMock;

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    oAuthRefreshToken: {
      findUnique: findUniqueMock,
      updateMany: updateManyMock,
      create: createMock,
      update: updateMock,
    },
  },
}));

const live = (over: Record<string, unknown> = {}) => ({
  id: "rt-1",
  tokenHash: "hash",
  clientId: "client-a",
  subjectAddress: "addr1",
  grantedAddresses: ["addr1"],
  scopes: ["wallets:read"],
  resource: "https://x/api/mcp",
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  replacedById: null,
  createdAt: new Date(),
  ...over,
});

let store: typeof import("@/lib/oauth/tokens");

beforeEach(async () => {
  jest.clearAllMocks();
  updateManyMock.mockResolvedValue({ count: 1 });
  createMock.mockResolvedValue({ id: "rt-new" });
  updateMock.mockResolvedValue({});
  findUniqueMock.mockResolvedValue(live());
  store = await import("@/lib/oauth/tokens");
});

describe("redeemRefreshToken", () => {
  it("redeems a live token and claims it atomically", async () => {
    const result = await store.redeemRefreshToken("tok", "client-a");

    expect(result.ok).toBe(true);
    // The claim must be conditional on the row still being unclaimed, or two
    // concurrent redemptions could both succeed.
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revokedAt: null, replacedById: null }),
      }),
    );
  });

  it("rejects a token belonging to another client", async () => {
    const result = await store.redeemRefreshToken("tok", "client-b");
    expect(result).toEqual({ ok: false, reason: "unknown" });
  });

  it("rejects an unknown token", async () => {
    findUniqueMock.mockResolvedValue(null);
    expect(await store.redeemRefreshToken("tok", "client-a")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("rejects an expired token", async () => {
    findUniqueMock.mockResolvedValue(live({ expiresAt: new Date(Date.now() - 1) }));
    expect(await store.redeemRefreshToken("tok", "client-a")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a revoked token", async () => {
    findUniqueMock.mockResolvedValue(live({ revokedAt: new Date() }));
    expect(await store.redeemRefreshToken("tok", "client-a")).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("revokes the whole chain when a rotated token is replayed", async () => {
    // A token that already has a successor has been used twice, which means it
    // leaked — refusing just this request would leave the thief's copy live.
    findUniqueMock.mockResolvedValue(live({ replacedById: "rt-2" }));

    const result = await store.redeemRefreshToken("tok", "client-a");

    expect(result).toEqual({ ok: false, reason: "replayed" });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { clientId: "client-a", subjectAddress: "addr1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("treats losing the atomic claim as a replay and revokes the chain", async () => {
    // Another request claimed the row between our read and our write.
    updateManyMock.mockResolvedValueOnce({ count: 0 });

    const result = await store.redeemRefreshToken("tok", "client-a");

    expect(result).toEqual({ ok: false, reason: "replayed" });
    expect(updateManyMock).toHaveBeenCalledTimes(2);
  });
});

describe("issueRefreshToken", () => {
  it("stores only a hash, never the token itself", async () => {
    const token = await store.issueRefreshToken({
      clientId: "client-a",
      subjectAddress: "addr1",
      grantedAddresses: ["addr1"],
      scopes: ["wallets:read"],
      resource: "https://x/api/mcp",
    });

    const written = createMock.mock.calls[0]?.[0] as {
      data: { tokenHash: string };
    };
    expect(written.data.tokenHash).not.toBe(token);
    expect(written.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(written)).not.toContain(token);
  });
});
