import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PrismaClient } from "@prisma/client";

const submitTxMock = jest.fn<(txCbor: string) => Promise<string>>();

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: () => ({ submitTx: submitTxMock }),
}), { virtual: true });

let createPendingMultisigTransaction: typeof import("@/lib/server/createPendingMultisigTransaction").createPendingMultisigTransaction;

function makeDb() {
  return {
    transaction: {
      create: jest.fn<() => Promise<{ id: string }>>().mockResolvedValue({ id: "tx-1" }),
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
