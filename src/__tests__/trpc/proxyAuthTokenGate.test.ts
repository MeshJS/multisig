import { beforeAll, beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";

import { realTestAddresses } from "../testUtils";
import { cleanupFixtures, seedWallet } from "./fixtures";
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

// The audit itself is covered by proxyAuthTokenAudit.server.test.ts; here we pin
// that the router actually consults it and refuses on a non-null answer.
const auditPendingTxForProxyWalletMock = jest.fn<
  (...args: unknown[]) => Promise<string | null>
>();
jest.mock("@/lib/server/proxyAuthTokenAudit", () => ({
  __esModule: true,
  auditPendingTxForProxyWallet: auditPendingTxForProxyWalletMock,
}));

const HAVE_DB = !!process.env.DATABASE_URL;
const describeWithDb = HAVE_DB ? describe : describe.skip;

let createCaller: typeof import("@/server/api/root").createCaller;
let db: typeof import("@/server/db").db;
let walletId: string | undefined;

const SIGNER = realTestAddresses.address1;
const REFUSAL = "Transaction moves a proxy auth token away from the wallet address: output #1";

describeWithDb("proxy auth-token gate in the transaction router", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
    ({ db } = await import("@/server/db"));
  });

  beforeEach(() => {
    auditPendingTxForProxyWalletMock.mockReset();
    auditPendingTxForProxyWalletMock.mockResolvedValue(null);
  });

  afterEach(async () => {
    if (walletId) {
      await cleanupFixtures(db, { walletId });
      walletId = undefined;
    }
  });

  async function seedCaller() {
    ({ walletId } = await seedWallet(db, SIGNER));
    return createCaller(makeWalletCtx(SIGNER, db) as any);
  }

  it("createTransaction consults the audit and refuses an unsafe transaction before persisting", async () => {
    const caller = await seedCaller();
    auditPendingTxForProxyWalletMock.mockResolvedValue(REFUSAL);

    await expect(
      caller.transaction.createTransaction({
        walletId: walletId!,
        txJson: JSON.stringify({ body: {} }),
        signedAddresses: [SIGNER],
        txCbor: "deadbeef",
        state: 0,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: REFUSAL });

    expect(auditPendingTxForProxyWalletMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        signerAddress: SIGNER,
        txCbor: "deadbeef",
        context: "transaction.createTransaction",
      }),
    );
    await expect(db.transaction.findMany({ where: { walletId } })).resolves.toHaveLength(0);
  });

  it("createTransaction persists when the audit passes", async () => {
    const caller = await seedCaller();

    const created = await caller.transaction.createTransaction({
      walletId: walletId!,
      txJson: JSON.stringify({ body: {} }),
      signedAddresses: [],
      txCbor: "deadbeef",
      state: 0,
    });

    expect(created.id).toBeTruthy();
    expect(auditPendingTxForProxyWalletMock).toHaveBeenCalledTimes(1);
  });

  it("preSignProxyAudit returns the audit message so the browser can refuse before signing", async () => {
    const caller = await seedCaller();
    auditPendingTxForProxyWalletMock.mockResolvedValue(REFUSAL);

    await expect(
      caller.transaction.preSignProxyAudit({ walletId: walletId!, txCbor: "deadbeef" }),
    ).resolves.toEqual({ error: REFUSAL });

    auditPendingTxForProxyWalletMock.mockResolvedValue(null);
    await expect(
      caller.transaction.preSignProxyAudit({ walletId: walletId!, txCbor: "deadbeef" }),
    ).resolves.toEqual({ error: null });
  });

  it("preSignProxyAudit requires wallet access", async () => {
    await seedCaller();
    const stranger = createCaller(makeWalletCtx(realTestAddresses.address2, db) as any);

    await expect(
      stranger.transaction.preSignProxyAudit({ walletId: walletId!, txCbor: "deadbeef" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(auditPendingTxForProxyWalletMock).not.toHaveBeenCalled();
  });
});
