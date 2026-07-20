import { describe, expect, it, jest, beforeAll, beforeEach } from "@jest/globals";

import { makeAnonymousCtx, makeWalletCtx } from "./helpers";
import { keyHashToEnterpriseAddress } from "@/utils/cip146Discovery";
import { paymentKeyHash } from "@/utils/multisigSDK";
import { mockKeyHashes } from "../testUtils";

jest.mock("@/env", () => ({
  __esModule: true,
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    NODE_ENV: "test",
  },
}), { virtual: true });

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

const claimHash = mockKeyHashes.payment1;
const otherHash = mockKeyHashes.payment2;
// A real bech32 address whose payment key hash equals claimHash — this is
// what the claiming user's session address looks like.
const claimerAddress = keyHashToEnterpriseAddress(claimHash, 0);

const makeMockDb = () => ({
  newWallet: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  auditLog: { create: jest.fn() },
});

const draft = (overrides: Record<string, unknown> = {}) => ({
  id: "draft-1",
  name: "Discovered wallet",
  ownerAddress: "addr_test1importer",
  signersAddresses: ["addr_test1importer", claimHash, otherHash],
  signersStakeKeys: ["", "", ""],
  signersDRepKeys: ["", "", ""],
  signersDescriptions: ["Importer", "Alice", "Bob"],
  stakeCredentialHash: mockKeyHashes.stake1,
  rawImportBodies: { lockedSigners: true },
  ...overrides,
});

describe("claimNewWalletSignerSlot", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws UNAUTHORIZED without a session", async () => {
    const mockDb = makeMockDb();
    const caller = createCaller(makeAnonymousCtx(mockDb) as any);

    await expect(
      caller.wallet.claimNewWalletSignerSlot({ walletId: "draft-1" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mockDb.newWallet.findUnique).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the draft does not exist", async () => {
    const mockDb = makeMockDb();
    mockDb.newWallet.findUnique.mockResolvedValueOnce(null as never);
    const caller = createCaller(makeWalletCtx(claimerAddress, mockDb) as any);

    await expect(
      caller.wallet.claimNewWalletSignerSlot({ walletId: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN when the draft is not a locked-signers draft", async () => {
    const mockDb = makeMockDb();
    mockDb.newWallet.findUnique.mockResolvedValueOnce(
      draft({ rawImportBodies: null }) as never,
    );
    const caller = createCaller(makeWalletCtx(claimerAddress, mockDb) as any);

    await expect(
      caller.wallet.claimNewWalletSignerSlot({ walletId: "draft-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockDb.newWallet.updateMany).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when the caller's key hash matches no placeholder", async () => {
    const mockDb = makeMockDb();
    mockDb.newWallet.findUnique.mockResolvedValueOnce(
      draft({ signersAddresses: ["addr_test1importer", otherHash] }) as never,
    );
    const caller = createCaller(makeWalletCtx(claimerAddress, mockDb) as any);

    await expect(
      caller.wallet.claimNewWalletSignerSlot({ walletId: "draft-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockDb.newWallet.updateMany).not.toHaveBeenCalled();
  });

  it("is a no-op when the caller has already claimed", async () => {
    const mockDb = makeMockDb();
    const existing = draft({
      signersAddresses: ["addr_test1importer", claimerAddress, otherHash],
    });
    mockDb.newWallet.findUnique.mockResolvedValueOnce(existing as never);
    const caller = createCaller(makeWalletCtx(claimerAddress, mockDb) as any);

    const result = await caller.wallet.claimNewWalletSignerSlot({
      walletId: "draft-1",
    });
    expect(result).toEqual(existing);
    expect(mockDb.newWallet.updateMany).not.toHaveBeenCalled();
  });

  it("claims exactly the matching slot and keeps arrays aligned", async () => {
    const mockDb = makeMockDb();
    const original = draft();
    mockDb.newWallet.findUnique
      .mockResolvedValueOnce(original as never)
      .mockResolvedValueOnce("updated-draft" as never);
    mockDb.user.findUnique.mockResolvedValueOnce({
      address: claimerAddress,
      stakeAddress: "stake_test1claimer",
      drepKeyHash: mockKeyHashes.drep1,
    } as never);
    mockDb.newWallet.updateMany.mockResolvedValueOnce({ count: 1 } as never);

    const caller = createCaller(makeWalletCtx(claimerAddress, mockDb) as any);
    const result = await caller.wallet.claimNewWalletSignerSlot({
      walletId: "draft-1",
      description: "Alice B",
    });

    expect(paymentKeyHash(claimerAddress)).toBe(claimHash);
    expect(mockDb.newWallet.updateMany).toHaveBeenCalledWith({
      where: {
        id: "draft-1",
        signersAddresses: { equals: original.signersAddresses },
      },
      data: {
        signersAddresses: ["addr_test1importer", claimerAddress, otherHash],
        // stake key stays empty: the fixed on-chain script + external
        // stake credential are authoritative
        signersStakeKeys: ["", "", ""],
        signersDRepKeys: ["", mockKeyHashes.drep1, ""],
        signersDescriptions: ["Importer", "Alice B", "Bob"],
      },
    });
    expect(result).toBe("updated-draft");
  });

  it("claims the connected wallet's slot even when the session primary already occupies another slot", async () => {
    // Multi-wallet session: the primary (most recently authorized) address
    // is the draft owner, but the connected wallet's address is also in
    // sessionWallets. The mutation must claim the placeholder instead of
    // idempotently returning "owner is already a signer".
    const mockDb = makeMockDb();
    const original = draft();
    mockDb.newWallet.findUnique
      .mockResolvedValueOnce(original as never)
      .mockResolvedValueOnce("updated-draft" as never);
    mockDb.user.findUnique.mockResolvedValueOnce(null as never);
    mockDb.newWallet.updateMany.mockResolvedValueOnce({ count: 1 } as never);

    const stalePrimaryCtx = {
      db: mockDb,
      session: null,
      sessionAddress: "addr_test1importer",
      sessionWallets: ["addr_test1importer", claimerAddress],
      primaryWallet: "addr_test1importer",
      ip: "198.51.100.200",
    };
    const caller = createCaller(stalePrimaryCtx as any);
    const result = await caller.wallet.claimNewWalletSignerSlot({
      walletId: "draft-1",
    });

    expect(mockDb.newWallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          signersAddresses: ["addr_test1importer", claimerAddress, otherHash],
        }),
      }),
    );
    expect(result).toBe("updated-draft");
  });

  it("rejects an explicit claiming address that is not in the session", async () => {
    const mockDb = makeMockDb();
    const caller = createCaller(makeWalletCtx(claimerAddress, mockDb) as any);

    await expect(
      caller.wallet.claimNewWalletSignerSlot({
        walletId: "draft-1",
        address: "addr_test1somebodyelse",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockDb.newWallet.findUnique).not.toHaveBeenCalled();
  });

  it("binds the claim to an explicit address from the session", async () => {
    const mockDb = makeMockDb();
    const original = draft();
    mockDb.newWallet.findUnique
      .mockResolvedValueOnce(original as never)
      .mockResolvedValueOnce("updated-draft" as never);
    mockDb.user.findUnique.mockResolvedValueOnce(null as never);
    mockDb.newWallet.updateMany.mockResolvedValueOnce({ count: 1 } as never);

    const caller = createCaller(makeWalletCtx(claimerAddress, mockDb) as any);
    const result = await caller.wallet.claimNewWalletSignerSlot({
      walletId: "draft-1",
      address: claimerAddress,
    });

    expect(mockDb.user.findUnique).toHaveBeenCalledWith({
      where: { address: claimerAddress },
    });
    expect(result).toBe("updated-draft");
  });

  it("throws CONFLICT when the signer list changed concurrently", async () => {
    const mockDb = makeMockDb();
    mockDb.newWallet.findUnique.mockResolvedValueOnce(draft() as never);
    mockDb.user.findUnique.mockResolvedValueOnce(null as never);
    mockDb.newWallet.updateMany.mockResolvedValueOnce({ count: 0 } as never);

    const caller = createCaller(makeWalletCtx(claimerAddress, mockDb) as any);
    await expect(
      caller.wallet.claimNewWalletSignerSlot({ walletId: "draft-1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
