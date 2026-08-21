import { describe, expect, it, jest, beforeAll, beforeEach } from "@jest/globals";

import { makeWalletCtx } from "./helpers";

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

const SIGNER = "addr_signer";
const COSIGNER = "addr_cosigner";
const WALLET_ID = "wallet-1";

const makeMockDb = () => ({
  wallet: { findUnique: jest.fn() },
  walletSignerNotificationSetting: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  emailVerificationToken: {
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  notificationDelivery: { upsert: jest.fn() },
  transaction: { findUnique: jest.fn() },
  signable: { findUnique: jest.fn() },
});

type MockDb = ReturnType<typeof makeMockDb>;

const wallet = (overrides: Record<string, unknown> = {}) => ({
  id: WALLET_ID,
  name: "Test Wallet",
  signersAddresses: [SIGNER, COSIGNER],
  ownerAddress: null,
  numRequiredSigners: 2,
  type: "atLeast",
  ...overrides,
});

const storedSetting = (overrides: Record<string, unknown> = {}) => ({
  id: "setting-1",
  walletId: WALLET_ID,
  signerAddress: SIGNER,
  email: "signer@example.com",
  emailNormalized: "signer@example.com",
  emailVerifiedAt: new Date(),
  emailOptIn: true,
  notifyTransactionSignatures: true,
  notifySignableSignatures: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function callerFor(mockDb: MockDb, address = SIGNER) {
  return createCaller(makeWalletCtx(address, mockDb) as any);
}

describe("notification router", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getWalletSignerSetting", () => {
    it("returns opted-in defaults when no row exists", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
      mockDb.walletSignerNotificationSetting.findUnique.mockResolvedValueOnce(
        null as never,
      );

      const result = await callerFor(mockDb).notification.getWalletSignerSetting({
        walletId: WALLET_ID,
        signerAddress: SIGNER,
      });

      expect(result).toEqual({
        id: null,
        walletId: WALLET_ID,
        signerAddress: SIGNER,
        email: null,
        emailNormalized: null,
        emailVerifiedAt: null,
        emailOptIn: true,
        notifyTransactionSignatures: true,
        notifySignableSignatures: true,
        createdAt: null,
        updatedAt: null,
      });
    });

    it("returns the stored row when present", async () => {
      const mockDb = makeMockDb();
      const setting = storedSetting();
      mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
      mockDb.walletSignerNotificationSetting.findUnique.mockResolvedValueOnce(
        setting as never,
      );

      await expect(
        callerFor(mockDb).notification.getWalletSignerSetting({
          walletId: WALLET_ID,
          signerAddress: SIGNER,
        }),
      ).resolves.toBe(setting);
    });

    it("rejects a signer address the session has not authorized", async () => {
      const mockDb = makeMockDb();

      await expect(
        callerFor(mockDb, SIGNER).notification.getWalletSignerSetting({
          walletId: WALLET_ID,
          signerAddress: COSIGNER,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mockDb.walletSignerNotificationSetting.findUnique).not.toHaveBeenCalled();
    });

    it("rejects a wallet owner who is not a signer", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValueOnce(
        wallet({ signersAddresses: [COSIGNER], ownerAddress: SIGNER }) as never,
      );

      await expect(
        callerFor(mockDb, SIGNER).notification.getWalletSignerSetting({
          walletId: WALLET_ID,
          signerAddress: SIGNER,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("upsertWalletSignerSetting", () => {
    it("creates a setting with a normalized email and unverified state", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
      mockDb.walletSignerNotificationSetting.findUnique.mockResolvedValueOnce(
        null as never,
      );
      mockDb.walletSignerNotificationSetting.upsert.mockResolvedValueOnce(
        storedSetting() as never,
      );
      mockDb.emailVerificationToken.updateMany.mockResolvedValueOnce(
        { count: 0 } as never,
      );

      await callerFor(mockDb).notification.upsertWalletSignerSetting({
        walletId: WALLET_ID,
        signerAddress: SIGNER,
        email: "Signer@Example.com",
      });

      expect(mockDb.walletSignerNotificationSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            email: "Signer@Example.com",
            emailNormalized: "signer@example.com",
            emailVerifiedAt: null,
            emailOptIn: true,
            notifyTransactionSignatures: true,
            notifySignableSignatures: true,
          }),
        }),
      );
    });

    it("invalidates outstanding verification tokens when the email changes", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
      mockDb.walletSignerNotificationSetting.findUnique.mockResolvedValueOnce(
        storedSetting({ emailNormalized: "old@example.com" }) as never,
      );
      mockDb.walletSignerNotificationSetting.upsert.mockResolvedValueOnce(
        storedSetting() as never,
      );
      mockDb.emailVerificationToken.updateMany.mockResolvedValueOnce(
        { count: 1 } as never,
      );

      await callerFor(mockDb).notification.upsertWalletSignerSetting({
        walletId: WALLET_ID,
        signerAddress: SIGNER,
        email: "new@example.com",
      });

      // The changed email resets verification and consumes pending tokens.
      expect(mockDb.walletSignerNotificationSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            emailNormalized: "new@example.com",
            emailVerifiedAt: null,
          }),
        }),
      );
      expect(mockDb.emailVerificationToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            walletId: WALLET_ID,
            signerAddress: SIGNER,
            consumedAt: null,
          }),
        }),
      );
    });

    it("updates preferences without touching the stored email", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
      mockDb.walletSignerNotificationSetting.findUnique.mockResolvedValueOnce(
        storedSetting() as never,
      );
      mockDb.walletSignerNotificationSetting.upsert.mockResolvedValueOnce(
        storedSetting({ notifyTransactionSignatures: false }) as never,
      );

      await callerFor(mockDb).notification.upsertWalletSignerSetting({
        walletId: WALLET_ID,
        signerAddress: SIGNER,
        notifyTransactionSignatures: false,
      });

      const upsertArgs = mockDb.walletSignerNotificationSetting.upsert.mock
        .calls[0]![0] as { update: Record<string, unknown> };
      expect(upsertArgs.update).toEqual({ notifyTransactionSignatures: false });
      expect(mockDb.emailVerificationToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("sendVerificationEmail", () => {
    it("requires a saved email address first", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
      mockDb.walletSignerNotificationSetting.findUnique.mockResolvedValueOnce(
        storedSetting({ email: null, emailNormalized: null }) as never,
      );

      await expect(
        callerFor(mockDb).notification.sendVerificationEmail({
          walletId: WALLET_ID,
          signerAddress: SIGNER,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mockDb.emailVerificationToken.create).not.toHaveBeenCalled();
    });

    it("stores a hashed token and enqueues the verify email", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
      mockDb.walletSignerNotificationSetting.findUnique.mockResolvedValueOnce(
        storedSetting() as never,
      );
      mockDb.emailVerificationToken.create.mockResolvedValueOnce({} as never);
      mockDb.notificationDelivery.upsert.mockResolvedValueOnce(
        { id: "delivery-1" } as never,
      );

      const result = await callerFor(mockDb).notification.sendVerificationEmail({
        walletId: WALLET_ID,
        signerAddress: SIGNER,
      });

      // NOTIFICATIONS_EMAIL_ENABLED is unset in tests → enqueue only, no send.
      expect(result).toEqual({ deliveryId: "delivery-1", emailEnabled: false });

      const tokenArgs = mockDb.emailVerificationToken.create.mock.calls[0]![0] as {
        data: { tokenHash: string; emailNormalized: string; expiresAt: Date };
      };
      // Only the sha256 hash is persisted, never the raw token.
      expect(tokenArgs.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(tokenArgs.data.emailNormalized).toBe("signer@example.com");
      expect(tokenArgs.data.expiresAt).toBeInstanceOf(Date);

      expect(mockDb.notificationDelivery.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            eventType: "email.verify",
            recipientAddress: SIGNER,
            recipientEmail: "signer@example.com",
            resourceType: "wallet",
            resourceId: WALLET_ID,
          }),
        }),
      );
    });
  });

  describe("sendSignatureReminder", () => {
    const pendingTx = (overrides: Record<string, unknown> = {}) => ({
      id: "tx-1",
      walletId: WALLET_ID,
      state: 0,
      signedAddresses: [],
      rejectedAddresses: [],
      description: null,
      txJson: JSON.stringify({ body: {} }),
      ...overrides,
    });

    it("rejects a recipient who is not a wallet signer", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);

      await expect(
        callerFor(mockDb).notification.sendSignatureReminder({
          walletId: WALLET_ID,
          resourceType: "transaction",
          resourceId: "tx-1",
          recipientAddress: "addr_outsider",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws NOT_FOUND when the transaction belongs to another wallet", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
      mockDb.transaction.findUnique.mockResolvedValueOnce(
        pendingTx({ walletId: "other-wallet" }) as never,
      );

      await expect(
        callerFor(mockDb).notification.sendSignatureReminder({
          walletId: WALLET_ID,
          resourceType: "transaction",
          resourceId: "tx-1",
          recipientAddress: COSIGNER,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("rejects reminders for recipients who already signed", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
      mockDb.transaction.findUnique.mockResolvedValueOnce(
        pendingTx({ signedAddresses: [COSIGNER] }) as never,
      );

      await expect(
        callerFor(mockDb).notification.sendSignatureReminder({
          walletId: WALLET_ID,
          resourceType: "transaction",
          resourceId: "tx-1",
          recipientAddress: COSIGNER,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("enqueues a reminder delivery targeted at the one recipient", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
      mockDb.transaction.findUnique.mockResolvedValueOnce(pendingTx() as never);
      mockDb.walletSignerNotificationSetting.findMany.mockResolvedValueOnce([
        storedSetting({
          signerAddress: COSIGNER,
          email: "cosigner@example.com",
          emailNormalized: "cosigner@example.com",
        }),
      ] as never);
      mockDb.notificationDelivery.upsert.mockResolvedValueOnce(
        { id: "delivery-1" } as never,
      );

      const result = await callerFor(mockDb).notification.sendSignatureReminder({
        walletId: WALLET_ID,
        resourceType: "transaction",
        resourceId: "tx-1",
        recipientAddress: COSIGNER,
      });

      expect(result).toEqual([{ id: "delivery-1" }]);
      expect(
        mockDb.walletSignerNotificationSetting.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            walletId: WALLET_ID,
            signerAddress: { in: [COSIGNER] },
          }),
        }),
      );
      expect(mockDb.notificationDelivery.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            eventType: "signature.reminder",
            recipientAddress: COSIGNER,
            recipientEmail: "cosigner@example.com",
            resourceType: "transaction",
            resourceId: "tx-1",
            status: "pending",
          }),
        }),
      );
    });

    it("throws NOT_FOUND for a missing signable", async () => {
      const mockDb = makeMockDb();
      mockDb.wallet.findUnique.mockResolvedValueOnce(wallet() as never);
      mockDb.signable.findUnique.mockResolvedValueOnce(null as never);

      await expect(
        callerFor(mockDb).notification.sendSignatureReminder({
          walletId: WALLET_ID,
          resourceType: "signable",
          resourceId: "sig-1",
          recipientAddress: COSIGNER,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
