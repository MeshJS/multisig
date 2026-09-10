import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PrismaClient } from "@prisma/client";

const submitTxMock = jest.fn<(txCbor: string) => Promise<string>>();
const enqueueMock = jest
  .fn<(...args: unknown[]) => Promise<unknown[]>>()
  .mockResolvedValue([]);

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: () => ({ submitTx: submitTxMock }),
}));

jest.mock("@/lib/notifications/center", () => ({
  __esModule: true,
  enqueueSignatureRequiredNotifications: enqueueMock,
}));

let createPendingMultisigTransaction: typeof import("@/lib/server/createPendingMultisigTransaction").createPendingMultisigTransaction;

function makeDb() {
  return {
    transaction: {
      create: jest
        .fn<() => Promise<{ id: string; signedAddresses: string[]; rejectedAddresses: string[] }>>()
        .mockResolvedValue({ id: "tx-1", signedAddresses: [], rejectedAddresses: [] }),
    },
    wallet: {
      findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        id: "wallet-1",
        name: "Treasury",
        signersAddresses: ["addr_test_proposer", "addr_test_other"],
        numRequiredSigners: 2,
        type: "atLeast",
      }),
    },
  } as unknown as PrismaClient;
}

const baseArgs = {
  walletId: "wallet-1",
  wallet: { numRequiredSigners: 2, type: "atLeast" },
  proposerAddress: "addr_test_proposer",
  txCbor: "tx-cbor",
  txJson: { body: "json" },
  description: "test transaction",
  network: 0,
};

describe("createPendingMultisigTransaction", () => {
  beforeAll(async () => {
    ({ createPendingMultisigTransaction } = await import("@/lib/server/createPendingMultisigTransaction"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    submitTxMock.mockResolvedValue("submitted-hash");
  });

  it("defaults pending transactions to signed by the proposer", async () => {
    const db = makeDb();

    await createPendingMultisigTransaction(db, baseArgs);

    expect(db.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        walletId: "wallet-1",
        signedAddresses: ["addr_test_proposer"],
      }),
    });
  });

  it("allows server-built transactions to start with no signed addresses", async () => {
    const db = makeDb();

    await createPendingMultisigTransaction(db, {
      ...baseArgs,
      initialSignedAddresses: [],
    });

    expect(db.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        signedAddresses: [],
      }),
    });
  });

  it("keeps one-signer server-built transactions pending until a witness exists", async () => {
    const db = makeDb();

    await createPendingMultisigTransaction(db, {
      ...baseArgs,
      wallet: { numRequiredSigners: 1, type: "all" },
      initialSignedAddresses: [],
    });

    expect(db.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        signedAddresses: [],
      }),
    });
    expect(submitTxMock).not.toHaveBeenCalled();
  });

  it("treats the proposer as the notification creator by default", async () => {
    await createPendingMultisigTransaction(makeDb(), baseArgs);

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ creatorAddress: "addr_test_proposer" }),
    );
  });

  it("can notify the proposer too when they have not signed (MCP drafts)", async () => {
    // The recipient resolver skips the creator on the assumption they signed
    // at creation. An MCP draft's proposer has not, so the caller opts out.
    await createPendingMultisigTransaction(makeDb(), {
      ...baseArgs,
      initialSignedAddresses: [],
      notificationCreatorAddress: null,
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ creatorAddress: null, signedAddresses: [] }),
    );
  });

  it("runs an after-create hook inside the insert's database transaction", async () => {
    // Task payouts link tasks to the row here; both must exist or neither.
    const db = makeDb();
    const txClient = {
      transaction: {
        create: jest
          .fn<() => Promise<{ id: string; signedAddresses: string[]; rejectedAddresses: string[] }>>()
          .mockResolvedValue({ id: "tx-1", signedAddresses: [], rejectedAddresses: [] }),
      },
    };
    (db as unknown as { $transaction: unknown }).$transaction = jest
      .fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
      .mockImplementation((fn) => fn(txClient));
    const afterCreate = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);

    const result = await createPendingMultisigTransaction(db, {
      ...baseArgs,
      initialSignedAddresses: [],
      afterCreate,
    });

    expect((db as unknown as { $transaction: jest.Mock }).$transaction).toHaveBeenCalledTimes(1);
    expect(txClient.transaction.create).toHaveBeenCalledTimes(1);
    expect(db.transaction.create).not.toHaveBeenCalled();
    expect(afterCreate).toHaveBeenCalledWith(txClient, expect.objectContaining({ id: "tx-1" }));
    expect(result).toMatchObject({ id: "tx-1" });
    // Notifications still go out afterwards, on the real client.
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a hook failure and sends no notification", async () => {
    const db = makeDb();
    (db as unknown as { $transaction: unknown }).$transaction = jest
      .fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
      .mockImplementation((fn) =>
        fn({
          transaction: {
            create: jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: "tx-1", signedAddresses: [], rejectedAddresses: [] }),
          },
        }),
      );
    const boom = new Error("tasks changed");

    await expect(
      createPendingMultisigTransaction(db, {
        ...baseArgs,
        initialSignedAddresses: [],
        afterCreate: async () => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("submits single-signer transactions without creating a pending row", async () => {
    const db = makeDb();

    await expect(
      createPendingMultisigTransaction(db, {
        ...baseArgs,
        wallet: { numRequiredSigners: 1, type: "atLeast" },
      }),
    ).resolves.toBe("submitted-hash");

    expect(submitTxMock).toHaveBeenCalledWith("tx-cbor");
    expect(db.transaction.create).not.toHaveBeenCalled();
  });
});
