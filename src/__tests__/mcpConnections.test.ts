import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * The MCP connections router — listing and revoking OAuth grants from the
 * profile page. The revoke path is an authorization boundary: it must act only
 * on grants belonging to the wallet session making the request.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyAsyncMock = jest.Mock<(...args: any[]) => any>;

const grantFindMany = jest.fn() as AnyAsyncMock;
const grantFindUnique = jest.fn() as AnyAsyncMock;
const grantDelete = jest.fn() as AnyAsyncMock;
const clientFindMany = jest.fn() as AnyAsyncMock;
const tokenFindMany = jest.fn() as AnyAsyncMock;
const tokenUpdateMany = jest.fn() as AnyAsyncMock;
const transaction = jest.fn() as AnyAsyncMock;
const auditMock = jest.fn() as AnyAsyncMock;

// ESM-mode mocking: this suite imports the tRPC router, which pulls superjson —
// ESM-only, and unusable in the CJS jest project. Registered in ESM_TESTS.
jest.unstable_mockModule("@/lib/observability/audit", () => ({
  __esModule: true,
  audit: auditMock,
}));

const ADDR = "addr1qpuser";
const OTHER = "addr1qpsomeoneelse";

function ctx(session: { primaryWallet?: string | null; sessionWallets?: string[] }) {
  // protectedProcedure gates on a non-empty sessionWallets (src/server/api/trpc.ts),
  // and the real context always sets both together, so mirror that here.
  const sessionWallets =
    session.sessionWallets ?? (session.primaryWallet ? [session.primaryWallet] : []);
  return {
    ...session,
    sessionWallets,
    db: {
      oAuthGrant: {
        findMany: grantFindMany,
        findUnique: grantFindUnique,
        delete: grantDelete,
      },
      oAuthClient: { findMany: clientFindMany },
      oAuthRefreshToken: { findMany: tokenFindMany, updateMany: tokenUpdateMany },
      $transaction: transaction,
    },
  };
}

let caller: (c: unknown) => any;

beforeEach(async () => {
  jest.clearAllMocks();
  transaction.mockImplementation(async (ops: unknown[]) => [undefined, { count: 2 }]);
  grantDelete.mockResolvedValue({});
  tokenUpdateMany.mockResolvedValue({ count: 2 });
  const { mcpRouter } = await import("@/server/api/routers/mcp");
  caller = (c) => (mcpRouter as any).createCaller(c);
});

describe("listConnections", () => {
  it("returns nothing when the address has approved no clients", async () => {
    grantFindMany.mockResolvedValue([]);
    const out = await caller(ctx({ primaryWallet: ADDR })).listConnections({
      requesterAddress: ADDR,
    });
    expect(out).toEqual([]);
    // No point querying clients or tokens when there are no grants.
    expect(clientFindMany).not.toHaveBeenCalled();
  });

  it("joins client metadata and counts only live sessions", async () => {
    grantFindMany.mockResolvedValue([
      {
        id: "g1",
        clientId: "https://claude.ai/oauth/x",
        subjectAddress: ADDR,
        scopes: ["wallets:read"],
        grantedAddresses: [ADDR],
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-02"),
      },
    ]);
    clientFindMany.mockResolvedValue([
      { clientId: "https://claude.ai/oauth/x", clientName: "Claude Code", clientUri: null, isMetadataUrl: true },
    ]);
    tokenFindMany.mockResolvedValue([
      { clientId: "https://claude.ai/oauth/x", expiresAt: new Date(Date.now() + 60_000) },
      // Expired: still unrevoked in the DB, but must not count as active.
      { clientId: "https://claude.ai/oauth/x", expiresAt: new Date(Date.now() - 60_000) },
    ]);

    const [conn] = await caller(ctx({ primaryWallet: ADDR })).listConnections({
      requesterAddress: ADDR,
    });

    expect(conn).toMatchObject({
      clientName: "Claude Code",
      isMetadataUrl: true,
      scopes: ["wallets:read"],
      activeSessions: 1,
    });
  });

  it("scopes the query to the session address", async () => {
    grantFindMany.mockResolvedValue([]);
    await caller(ctx({ primaryWallet: ADDR })).listConnections({ requesterAddress: ADDR });
    expect(grantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { subjectAddress: ADDR } }),
    );
  });

  it("labels a client the AS has no record of", async () => {
    grantFindMany.mockResolvedValue([
      {
        id: "g1", clientId: "gone", subjectAddress: ADDR, scopes: [], grantedAddresses: [ADDR],
        createdAt: new Date(), updatedAt: new Date(),
      },
    ]);
    clientFindMany.mockResolvedValue([]);
    tokenFindMany.mockResolvedValue([]);
    const [conn] = await caller(ctx({ primaryWallet: ADDR })).listConnections({
      requesterAddress: ADDR,
    });
    expect(conn.clientName).toBe("Unknown client");
  });
});

describe("revokeConnection", () => {
  it("deletes the grant and revokes its refresh tokens", async () => {
    grantFindUnique.mockResolvedValue({ id: "g1", scopes: ["wallets:read"] });

    const out = await caller(ctx({ primaryWallet: ADDR })).revokeConnection({
      clientId: "c1",
      requesterAddress: ADDR,
    });

    expect(out).toEqual({ ok: true, refreshTokensRevoked: 2 });
    // Both writes go through one transaction — a deleted grant with live
    // refresh tokens would let the client silently keep renewing.
    expect(transaction).toHaveBeenCalled();
    expect(tokenUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subjectAddress: ADDR, clientId: "c1", revokedAt: null },
      }),
    );
  });

  it("refuses an address the wallet session does not hold", async () => {
    // The body is attacker-controlled; only the session decides who you are.
    await expect(
      caller(ctx({ primaryWallet: ADDR })).revokeConnection({
        clientId: "c1",
        requesterAddress: OTHER,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses when there is no wallet session at all", async () => {
    await expect(
      caller(ctx({ primaryWallet: null, sessionWallets: [] })).revokeConnection({
        clientId: "c1",
        requesterAddress: ADDR,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("looks the grant up by (subject, client), not client alone", async () => {
    grantFindUnique.mockResolvedValue({ id: "g1", scopes: [] });
    await caller(ctx({ sessionWallets: [ADDR] })).revokeConnection({
      clientId: "c1",
      requesterAddress: ADDR,
    });
    expect(grantFindUnique).toHaveBeenCalledWith({
      where: { subjectAddress_clientId: { subjectAddress: ADDR, clientId: "c1" } },
    });
  });

  it("404s on a grant that does not exist", async () => {
    grantFindUnique.mockResolvedValue(null);
    await expect(
      caller(ctx({ primaryWallet: ADDR })).revokeConnection({
        clientId: "nope",
        requesterAddress: ADDR,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
