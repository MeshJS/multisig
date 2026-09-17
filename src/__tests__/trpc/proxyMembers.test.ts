import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { makeSessionCtx, makeWalletCtx } from "./helpers";

jest.mock("superjson", () => ({
  __esModule: true,
  default: {
    serialize: (value: unknown) => value,
    deserialize: (value: unknown) => value,
  },
}));

jest.mock("@/server/auth", () => ({
  __esModule: true,
  getServerAuthSession: jest.fn(),
}));

let createCaller: typeof import("@/server/api/root").createCaller;

// Bech32 payload charset excludes 1, b, i and o, so these stand in for real
// addresses while still passing the router's shape check.
const SIGNER = `addr_test1qs${"q".repeat(50)}`;
const OUTSIDER = `addr_test1qr${"q".repeat(50)}`;
const GUEST = `addr_test1qz${"q".repeat(50)}`;

const makeMockDb = () => ({
  wallet: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  proxy: { findUnique: jest.fn(), findMany: jest.fn() },
  proxyMember: {
    findMany: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
});

const proxyRow = {
  id: "proxy-1",
  walletId: "wallet-1",
  userId: null,
  proxyAddress: "addr_test1proxy",
  authTokenId: "token-1",
  paramUtxo: "txhash#0",
  description: "Treasury proxy",
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const signerWallet = {
  id: "wallet-1",
  signersAddresses: [SIGNER],
};

describe("proxy member management", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("listProxyMembers", () => {
    it("returns members and manage rights for a signer of the controlling wallet", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValue(signerWallet as never);
      mockDb.proxy.findMany.mockResolvedValue([proxyRow] as never);
      mockDb.proxyMember.findMany.mockResolvedValue([
        {
          id: "member-1",
          proxyId: "proxy-1",
          address: GUEST,
          role: "viewer",
          label: "Auditor",
          invitedBy: SIGNER,
          createdAt: new Date("2026-02-01T00:00:00Z"),
        },
      ] as never);

      const caller = createCaller(makeWalletCtx(SIGNER, mockDb) as any);
      const result = await caller.proxy.listProxyMembers({ proxyIds: ["proxy-1"] });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ proxyId: "proxy-1", canManage: true, role: "owner" });
      expect(result[0]!.members).toHaveLength(1);
      expect(result[0]!.members[0]).toMatchObject({ address: GUEST, isSelf: false });
    });

    it("omits proxies the caller has no access to instead of throwing", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValue(signerWallet as never);
      mockDb.proxy.findMany.mockResolvedValue([proxyRow] as never);
      // No membership rows for the outsider.
      mockDb.proxyMember.findMany.mockResolvedValue([] as never);

      const caller = createCaller(makeWalletCtx(OUTSIDER, mockDb) as any);

      await expect(
        caller.proxy.listProxyMembers({ proxyIds: ["proxy-1"] }),
      ).resolves.toEqual([]);
    });

    it("grants read access to an invited member who is not a signer", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValue(signerWallet as never);
      mockDb.proxy.findMany.mockResolvedValue([proxyRow] as never);
      mockDb.proxyMember.findMany.mockResolvedValue([
        {
          id: "member-1",
          proxyId: "proxy-1",
          address: GUEST,
          role: "viewer",
          label: null,
          invitedBy: SIGNER,
          createdAt: new Date("2026-02-01T00:00:00Z"),
        },
      ] as never);

      const caller = createCaller(makeWalletCtx(GUEST, mockDb) as any);
      const result = await caller.proxy.listProxyMembers({ proxyIds: ["proxy-1"] });

      expect(result[0]).toMatchObject({ canManage: false, role: "viewer" });
      expect(result[0]!.members[0]).toMatchObject({ isSelf: true });
    });
  });

  describe("addProxyMembers", () => {
    it("rejects a caller with no access to the proxy", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValue(signerWallet as never);
      mockDb.proxy.findUnique.mockResolvedValue(proxyRow as never);
      mockDb.proxyMember.findMany.mockResolvedValue([] as never);

      const caller = createCaller(makeWalletCtx(OUTSIDER, mockDb) as any);

      await expect(
        caller.proxy.addProxyMembers({
          proxyId: "proxy-1",
          members: [{ address: GUEST, role: "viewer" }],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(mockDb.proxyMember.createMany).not.toHaveBeenCalled();
    });

    it("rejects a viewer trying to invite someone else", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValue(signerWallet as never);
      mockDb.proxy.findUnique.mockResolvedValue(proxyRow as never);
      mockDb.proxyMember.findMany.mockResolvedValue([
        { id: "m", proxyId: "proxy-1", address: GUEST, role: "viewer" },
      ] as never);

      const caller = createCaller(makeWalletCtx(GUEST, mockDb) as any);

      await expect(
        caller.proxy.addProxyMembers({
          proxyId: "proxy-1",
          members: [{ address: OUTSIDER, role: "viewer" }],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("allows a member with the manager role to invite", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValue(signerWallet as never);
      mockDb.proxy.findUnique.mockResolvedValue(proxyRow as never);
      mockDb.proxyMember.findMany.mockResolvedValue([
        { id: "m", proxyId: "proxy-1", address: GUEST, role: "manager" },
      ] as never);
      mockDb.proxyMember.createMany.mockResolvedValue({ count: 1 } as never);

      const caller = createCaller(makeWalletCtx(GUEST, mockDb) as any);

      await expect(
        caller.proxy.addProxyMembers({
          proxyId: "proxy-1",
          members: [{ address: OUTSIDER, role: "viewer", label: "Ops" }],
        }),
      ).resolves.toEqual({ added: 1, requested: 1 });

      expect(mockDb.proxyMember.createMany).toHaveBeenCalledWith({
        data: [
          {
            proxyId: "proxy-1",
            address: OUTSIDER,
            role: "viewer",
            label: "Ops",
            invitedBy: GUEST,
          },
        ],
        skipDuplicates: true,
      });
    });

    it("rejects malformed addresses before touching the database", async () => {
      const mockDb = makeMockDb();
      const caller = createCaller(makeWalletCtx(SIGNER, mockDb) as any);

      await expect(
        caller.proxy.addProxyMembers({
          proxyId: "proxy-1",
          members: [{ address: "not-an-address", role: "viewer" }],
        }),
      ).rejects.toBeInstanceOf(Error);

      expect(mockDb.proxy.findUnique).not.toHaveBeenCalled();
      expect(mockDb.proxyMember.createMany).not.toHaveBeenCalled();
    });

    it("collapses duplicate addresses in a single request", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValue(signerWallet as never);
      mockDb.proxy.findUnique.mockResolvedValue(proxyRow as never);
      mockDb.proxyMember.createMany.mockResolvedValue({ count: 1 } as never);

      const caller = createCaller(makeWalletCtx(SIGNER, mockDb) as any);

      await expect(
        caller.proxy.addProxyMembers({
          proxyId: "proxy-1",
          members: [
            { address: GUEST, role: "viewer" },
            { address: GUEST, role: "manager" },
          ],
        }),
      ).resolves.toEqual({ added: 1, requested: 1 });
    });
  });

  describe("removeProxyMember", () => {
    it("lets a viewer remove their own access without manage rights", async () => {
      const mockDb = makeMockDb();
      mockDb.proxyMember.deleteMany.mockResolvedValue({ count: 1 } as never);

      const caller = createCaller(makeWalletCtx(GUEST, mockDb) as any);

      await expect(
        caller.proxy.removeProxyMember({ proxyId: "proxy-1", address: GUEST }),
      ).resolves.toEqual({ removed: true });

      // Self-removal short-circuits the manage check entirely.
      expect(mockDb.proxy.findUnique).not.toHaveBeenCalled();
      expect(mockDb.proxyMember.deleteMany).toHaveBeenCalledWith({
        where: { proxyId: "proxy-1", address: GUEST },
      });
    });

    it("rejects removing someone else without manage rights", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValue(signerWallet as never);
      mockDb.proxy.findUnique.mockResolvedValue(proxyRow as never);
      mockDb.proxyMember.findMany.mockResolvedValue([
        { id: "m", proxyId: "proxy-1", address: GUEST, role: "viewer" },
      ] as never);

      const caller = createCaller(makeWalletCtx(GUEST, mockDb) as any);

      await expect(
        caller.proxy.removeProxyMember({ proxyId: "proxy-1", address: OUTSIDER }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(mockDb.proxyMember.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("getSharedProxies", () => {
    it("returns active proxies shared with the caller", async () => {
      const mockDb = makeMockDb();
      mockDb.proxyMember.findMany.mockResolvedValue([
        {
          id: "member-1",
          proxyId: "proxy-1",
          address: GUEST,
          role: "manager",
          label: "Auditor",
          invitedBy: SIGNER,
          createdAt: new Date("2026-02-01T00:00:00Z"),
        },
      ] as never);
      mockDb.proxy.findMany.mockResolvedValue([proxyRow] as never);

      const caller = createCaller(makeSessionCtx(GUEST, mockDb) as any);
      const result = await caller.proxy.getSharedProxies();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "proxy-1",
        role: "manager",
        memberAddress: GUEST,
      });
    });

    it("returns an empty list when nothing is shared", async () => {
      const mockDb = makeMockDb();
      mockDb.proxyMember.findMany.mockResolvedValue([] as never);

      const caller = createCaller(makeSessionCtx(GUEST, mockDb) as any);

      await expect(caller.proxy.getSharedProxies()).resolves.toEqual([]);
      expect(mockDb.proxy.findMany).not.toHaveBeenCalled();
    });
  });
});
