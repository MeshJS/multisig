import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { makeAnonymousCtx, makeWalletCtx } from "./helpers";

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

const SIGNER = "addr_test1signer";
const COSIGNER = "addr_test1cosigner";
const STRANGER = "addr_test1stranger";

const walletRow = {
  id: "wallet-1",
  ownerAddress: SIGNER,
  signersAddresses: [SIGNER, COSIGNER],
};

const activeMigration = {
  id: "migration-1",
  originalWalletId: walletRow.id,
  ownerAddress: SIGNER,
  status: "pending",
  currentStep: 0,
  migrationData: { plan: "secret" },
  createdAt: new Date("2026-11-01T00:00:00Z"),
};

const makeMockDb = (existing: typeof activeMigration | null = null) => ({
  wallet: {
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
      where.id === walletRow.id ? walletRow : null,
    ),
  },
  migration: {
    findFirst: jest.fn(async (_args: unknown) => existing),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "migration-new",
      ...data,
    })),
  },
});

/**
 * A wallet may have only one active migration. Whoever opens it therefore
 * holds a lock on the wallet's migration flow, and the row records who that
 * is and what they planned — so both opening and reading it are limited to
 * the wallet's own signers, not to anyone with a session.
 */
describe("migration router wallet authorization", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createMigration", () => {
    it("refuses a signed-in stranger without creating the lock", async () => {
      const db = makeMockDb();
      const caller = createCaller(makeWalletCtx(STRANGER, db) as any);

      await expect(
        caller.migration.createMigration({
          originalWalletId: walletRow.id,
          ownerAddress: STRANGER,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(db.migration.create).not.toHaveBeenCalled();
    });

    it("does not tell a stranger who holds an existing migration", async () => {
      const db = makeMockDb(activeMigration);
      const caller = createCaller(makeWalletCtx(STRANGER, db) as any);

      const attempt = caller.migration.createMigration({
        originalWalletId: walletRow.id,
        ownerAddress: STRANGER,
      });
      await expect(attempt).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(attempt).rejects.not.toThrow(SIGNER);
    });

    it("answers NOT_FOUND for a wallet id that does not exist", async () => {
      const db = makeMockDb();
      const caller = createCaller(makeWalletCtx(SIGNER, db) as any);

      await expect(
        caller.migration.createMigration({
          originalWalletId: "no-such-wallet",
          ownerAddress: SIGNER,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(db.migration.create).not.toHaveBeenCalled();
    });

    it("lets a signer open a migration for their wallet", async () => {
      const db = makeMockDb();
      const caller = createCaller(makeWalletCtx(COSIGNER, db) as any);

      const created = await caller.migration.createMigration({
        originalWalletId: walletRow.id,
        ownerAddress: COSIGNER,
      });

      expect(created).toMatchObject({
        originalWalletId: walletRow.id,
        ownerAddress: COSIGNER,
        status: "pending",
      });
    });

    it("still refuses an ownerAddress the session does not control", async () => {
      const db = makeMockDb();
      const caller = createCaller(makeWalletCtx(COSIGNER, db) as any);

      await expect(
        caller.migration.createMigration({
          originalWalletId: walletRow.id,
          ownerAddress: SIGNER,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // The address check comes first, so a mismatched caller learns nothing
      // about whether the wallet id exists.
      expect(db.wallet.findUnique).not.toHaveBeenCalled();
    });

    it("records the lock only under an address that belongs to the wallet", async () => {
      const db = makeMockDb();
      const ctx = makeWalletCtx(SIGNER, db);
      // One session holding a signer address and an unrelated one.
      ctx.sessionWallets = [SIGNER, STRANGER];
      const caller = createCaller(ctx as any);

      await expect(
        caller.migration.createMigration({
          originalWalletId: walletRow.id,
          ownerAddress: STRANGER,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(db.migration.create).not.toHaveBeenCalled();
    });
  });

  describe("getMigrationByOriginalWallet", () => {
    it("refuses an anonymous caller", async () => {
      const db = makeMockDb(activeMigration);
      const caller = createCaller(makeAnonymousCtx(db) as any);

      await expect(
        caller.migration.getMigrationByOriginalWallet({
          originalWalletId: walletRow.id,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      expect(db.migration.findFirst).not.toHaveBeenCalled();
    });

    it("refuses a signed-in stranger without reading the migration", async () => {
      const db = makeMockDb(activeMigration);
      const caller = createCaller(makeWalletCtx(STRANGER, db) as any);

      await expect(
        caller.migration.getMigrationByOriginalWallet({
          originalWalletId: walletRow.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(db.migration.findFirst).not.toHaveBeenCalled();
    });

    it("shows a co-signer the migration another signer started", async () => {
      const db = makeMockDb(activeMigration);
      const caller = createCaller(makeWalletCtx(COSIGNER, db) as any);

      await expect(
        caller.migration.getMigrationByOriginalWallet({
          originalWalletId: walletRow.id,
        }),
      ).resolves.toMatchObject({ id: activeMigration.id, ownerAddress: SIGNER });
    });

    it("returns null to a signer when no migration is active", async () => {
      const db = makeMockDb(null);
      const caller = createCaller(makeWalletCtx(SIGNER, db) as any);

      await expect(
        caller.migration.getMigrationByOriginalWallet({
          originalWalletId: walletRow.id,
        }),
      ).resolves.toBeNull();
    });
  });
});
