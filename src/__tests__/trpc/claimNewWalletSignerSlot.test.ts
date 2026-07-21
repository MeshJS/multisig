import { describe, expect, it, jest, beforeAll, beforeEach } from "@jest/globals";

import { makeAnonymousCtx, makeWalletCtx } from "./helpers";
import { serializeRewardAddress } from "@meshsdk/core";
import {
  deriveStakeCredentialFromKeys,
  keyHashToEnterpriseAddress,
} from "@/utils/cip146Discovery";
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

  describe("stake/DRep contribution with registration provenance", () => {
    const stakeHash = mockKeyHashes.stake2;
    const stakeAddress = serializeRewardAddress(stakeHash, false, 0);
    const drepHash = mockKeyHashes.drep1;

    const provenancedDraft = (
      participants: string[],
      types: number[],
      overrides: Record<string, unknown> = {},
    ) =>
      draft({
        rawImportBodies: {
          lockedSigners: true,
          provenance: { origin: "cip146-discovery", participants, types },
        },
        ...overrides,
      });

    async function runClaim(
      draftRow: ReturnType<typeof draft>,
      user: Record<string, unknown> | null,
    ) {
      const mockDb = makeMockDb();
      mockDb.newWallet.findUnique
        .mockResolvedValueOnce(draftRow as never)
        .mockResolvedValueOnce("updated" as never);
      mockDb.user.findUnique.mockResolvedValueOnce(user as never);
      mockDb.newWallet.updateMany.mockResolvedValueOnce({ count: 1 } as never);
      const caller = createCaller(makeWalletCtx(claimerAddress, mockDb) as any);
      await caller.wallet.claimNewWalletSignerSlot({ walletId: "draft-1" });
      const call = mockDb.newWallet.updateMany.mock.calls[0]![0] as {
        data: { signersStakeKeys: string[]; signersDRepKeys: string[] };
      };
      return call.data;
    }

    it("writes member stake and DRep keys", async () => {
      const data = await runClaim(
        provenancedDraft([claimHash, stakeHash, drepHash], [0, 2, 3]),
        { address: claimerAddress, stakeAddress, drepKeyHash: drepHash },
      );
      expect(data.signersStakeKeys[1]).toBe(stakeAddress);
      expect(data.signersDRepKeys[1]).toBe(drepHash);
    });

    it("blanks a stake key whose hash is not a registration participant", async () => {
      const data = await runClaim(
        provenancedDraft([claimHash, drepHash], [0, 2, 3]),
        { address: claimerAddress, stakeAddress, drepKeyHash: drepHash },
      );
      expect(data.signersStakeKeys[1]).toBe("");
    });

    it("survives a malformed stored stake address", async () => {
      const data = await runClaim(
        provenancedDraft([claimHash, stakeHash], [0, 2]),
        { address: claimerAddress, stakeAddress: "zz", drepKeyHash: null },
      );
      expect(data.signersStakeKeys[1]).toBe("");
    });

    it("blanks the DRep key when the registration has no role 3", async () => {
      const data = await runClaim(
        provenancedDraft([claimHash, stakeHash, drepHash], [0, 2]),
        { address: claimerAddress, stakeAddress, drepKeyHash: drepHash },
      );
      expect(data.signersDRepKeys[1]).toBe("");
    });

    it("blanks a non-member DRep key", async () => {
      const data = await runClaim(
        provenancedDraft([claimHash, stakeHash], [0, 2, 3]),
        { address: claimerAddress, stakeAddress, drepKeyHash: drepHash },
      );
      expect(data.signersDRepKeys[1]).toBe("");
    });

    it("keeps legacy behavior for drafts without provenance participants", async () => {
      const data = await runClaim(draft(), {
        address: claimerAddress,
        stakeAddress,
        drepKeyHash: drepHash,
      });
      expect(data.signersStakeKeys[1]).toBe("");
      expect(data.signersDRepKeys[1]).toBe(drepHash);
    });

    it("never clobbers pre-seeded recovered keys when the User row is empty", async () => {
      const preseededStake = serializeRewardAddress(stakeHash, false, 0);
      const data = await runClaim(
        provenancedDraft([claimHash, stakeHash, drepHash], [0, 2, 3], {
          signersStakeKeys: ["", preseededStake, ""],
          signersDRepKeys: ["", drepHash, ""],
        }),
        null,
      );
      expect(data.signersStakeKeys[1]).toBe(preseededStake);
      expect(data.signersDRepKeys[1]).toBe(drepHash);
    });

    it("keeps pre-seeded recovered keys over a contradicting User-row key", async () => {
      const preseededStake = serializeRewardAddress(stakeHash, false, 0);
      const foreignStake = serializeRewardAddress(mockKeyHashes.stake1, false, 0);
      const data = await runClaim(
        provenancedDraft(
          [claimHash, stakeHash, mockKeyHashes.stake1],
          [0, 2],
          { signersStakeKeys: ["", preseededStake, ""] },
        ),
        { address: claimerAddress, stakeAddress: foreignStake, drepKeyHash: null },
      );
      expect(data.signersStakeKeys[1]).toBe(preseededStake);
    });
  });

  describe("self-healing from registration provenance", () => {
    // Deterministic distinct 56-hex key hashes.
    const kh = (n: number) => n.toString(16).padStart(2, "0").repeat(28);
    const importerHash = kh(0x51);
    const importerAddress = keyHashToEnterpriseAddress(importerHash, 0);
    const thirdHash = kh(0x52);
    const stakes = [kh(0x61), kh(0x62), kh(0x63)];
    const claimerDRep = kh(0x71);
    // Draft rows carry no numRequiredSigners/scriptType — recovery falls
    // back to 1/"atLeast", so derive the expected credential the same way.
    const credential = deriveStakeCredentialFromKeys({
      stakeKeys: stakes,
      numRequiredSigners: 1,
      scriptType: "atLeast",
      networkId: 0,
    })!;

    it("recovers the claimed slot's stake and dRep keys when the User row lacks them", async () => {
      const participants = [
        importerHash,
        claimHash,
        thirdHash,
        ...stakes,
        claimerDRep,
      ];
      const draftRow = draft({
        signersAddresses: [importerAddress, claimHash, thirdHash],
        rawImportBodies: {
          lockedSigners: true,
          provenance: {
            origin: "cip146-discovery",
            participants,
            types: [0, 2, 3],
            participantNames: {
              [importerHash]: "Importer",
              [claimHash]: "Alice",
              [thirdHash]: "Bob",
              [stakes[0]!]: "Importer",
              [stakes[1]!]: "Alice",
              [stakes[2]!]: "Bob",
              [claimerDRep]: "Alice",
            },
            stakeCredentialHash: credential,
            network: 0,
          },
        },
      });

      const mockDb = makeMockDb();
      mockDb.newWallet.findUnique
        .mockResolvedValueOnce(draftRow as never)
        .mockResolvedValueOnce("updated" as never);
      mockDb.user.findUnique.mockResolvedValueOnce({
        address: claimerAddress,
        stakeAddress: null,
        drepKeyHash: null,
      } as never);
      mockDb.newWallet.updateMany.mockResolvedValueOnce({ count: 1 } as never);
      const caller = createCaller(makeWalletCtx(claimerAddress, mockDb) as any);
      await caller.wallet.claimNewWalletSignerSlot({ walletId: "draft-1" });

      const call = mockDb.newWallet.updateMany.mock.calls[0]![0] as {
        data: { signersStakeKeys: string[]; signersDRepKeys: string[] };
      };
      expect(call.data.signersStakeKeys[1]).toBe(
        serializeRewardAddress(stakes[1]!, false, 0),
      );
      expect(call.data.signersDRepKeys[1]).toBe(claimerDRep);
    });
  });
});
