import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/notifications/worker", () => ({
  __esModule: true,
  drainNotificationOutbox: jest.fn(async () => []),
}));

import {
  crossedSignatureThreshold,
  enqueueThresholdReachedNotifications,
} from "@/lib/notifications/center";
import {
  NOTIFICATION_EVENT_THRESHOLD_REACHED,
  NOTIFICATION_STATUS_PENDING,
  NOTIFICATION_STATUS_SKIPPED_NO_EMAIL,
} from "@/lib/notifications/events";
import { resolveWalletSignerRecipients } from "@/lib/notifications/recipients";
import { renderThresholdReachedEmail } from "@/lib/notifications/templates/thresholdReached";

const wallet = {
  id: "wallet_1",
  name: "Treasury",
  signersAddresses: ["addr_creator", "addr_second", "addr_third"],
  numRequiredSigners: 2,
  type: "atLeast",
};

function makeSetting(address: string, overrides: Record<string, unknown> = {}) {
  return {
    walletId: "wallet_1",
    signerAddress: address,
    email: `${address}@example.com`,
    emailNormalized: `${address}@example.com`,
    emailVerifiedAt: new Date(),
    emailOptIn: true,
    notifyTransactionSignatures: true,
    notifySignableSignatures: true,
    notifyThresholdReached: true,
    notifyBallotDeadlines: true,
    ...overrides,
  };
}

function makeDb(settings: unknown[]) {
  const upsert = jest.fn(
    async (args: { create: Record<string, unknown> }) => args.create,
  );
  return {
    db: {
      walletSignerNotificationSetting: {
        findMany: jest.fn(async () => settings),
      },
      notificationDelivery: { upsert },
    },
    upsert,
  };
}

describe("crossedSignatureThreshold", () => {
  it("fires only when the count moves from below to at-or-above required", () => {
    expect(
      crossedSignatureThreshold({ wallet, previousSignedCount: 1, signedCount: 2 }),
    ).toBe(true);
    expect(
      crossedSignatureThreshold({ wallet, previousSignedCount: 0, signedCount: 1 }),
    ).toBe(false);
    expect(
      crossedSignatureThreshold({ wallet, previousSignedCount: 2, signedCount: 3 }),
    ).toBe(false);
    expect(
      crossedSignatureThreshold({ wallet, previousSignedCount: 0, signedCount: 3 }),
    ).toBe(true);
  });

  it("uses the signer count for 'all' wallets and 1 for 'any'", () => {
    expect(
      crossedSignatureThreshold({
        wallet: { ...wallet, type: "all", numRequiredSigners: null },
        previousSignedCount: 2,
        signedCount: 3,
      }),
    ).toBe(true);
    expect(
      crossedSignatureThreshold({
        wallet: { ...wallet, type: "any" },
        previousSignedCount: 0,
        signedCount: 1,
      }),
    ).toBe(true);
  });
});

describe("resolveWalletSignerRecipients", () => {
  it("includes every signer except excluded ones and reports skip reasons", async () => {
    const { db } = makeDb([makeSetting("addr_creator"), makeSetting("addr_second")]);

    const result = await resolveWalletSignerRecipients(db as any, {
      walletId: "wallet_1",
      signerAddresses: wallet.signersAddresses,
      preferenceField: "notifyThresholdReached",
      excludeAddresses: ["addr_second", null],
    });

    expect(result.eligible.map((r) => r.address)).toEqual(["addr_creator"]);
    expect(result.skipped).toEqual([
      { address: "addr_third", reason: NOTIFICATION_STATUS_SKIPPED_NO_EMAIL },
    ]);
  });
});

describe("enqueueThresholdReachedNotifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does nothing when the update did not cross the threshold", async () => {
    const { db, upsert } = makeDb([makeSetting("addr_creator")]);

    const deliveries = await enqueueThresholdReachedNotifications(db as any, {
      wallet,
      resourceType: "transaction",
      resourceId: "tx_1",
      previousSignedAddresses: ["addr_creator"],
      signedAddresses: ["addr_creator"],
      actorAddress: "addr_creator",
    });

    expect(deliveries).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("notifies the creator and other signers but not the actor once crossed", async () => {
    const { db, upsert } = makeDb([
      makeSetting("addr_creator"),
      makeSetting("addr_second"),
      makeSetting("addr_third", { notifyThresholdReached: false }),
    ]);

    const deliveries = await enqueueThresholdReachedNotifications(db as any, {
      wallet,
      resourceType: "transaction",
      resourceId: "tx_1",
      previousSignedAddresses: ["addr_creator"],
      signedAddresses: ["addr_creator", "addr_second"],
      actorAddress: "addr_second",
      description: "Pay contractor",
      txHash: "abc123",
    });

    expect(upsert).toHaveBeenCalledTimes(2);
    const byAddress = new Map(
      deliveries.map((delivery: any) => [delivery.recipientAddress, delivery]),
    );
    expect(byAddress.get("addr_creator")).toMatchObject({
      eventType: NOTIFICATION_EVENT_THRESHOLD_REACHED,
      status: NOTIFICATION_STATUS_PENDING,
      recipientEmail: "addr_creator@example.com",
      idempotencyKey:
        "threshold.reached:email:transaction:tx_1:wallet_1:addr_creator",
      subject: "Signatures complete: Treasury",
    });
    expect(byAddress.get("addr_third")).toMatchObject({
      status: "skipped_disabled",
      recipientEmail: null,
    });
    expect(byAddress.has("addr_second")).toBe(false);
    const payload = byAddress.get("addr_creator")!.payload as Record<string, unknown>;
    expect(payload.txHash).toBe("abc123");
    expect(String(payload.text)).toContain("Submitted to the network.");
  });
});

describe("renderThresholdReachedEmail", () => {
  const base = {
    walletName: "Treasury <script>",
    resourceType: "transaction" as const,
    description: "Pay & deliver",
    signedCount: 2,
    requiredCount: 2,
    totalSigners: 3,
    actionUrl: "https://example.com/wallets/w/transactions",
    preferencesUrl: "https://example.com/wallets/w/info",
  };

  it("escapes dynamic values and reports a submitted transaction", () => {
    const template = renderThresholdReachedEmail({ ...base, txHash: "deadbeef" });
    expect(template.subject).toBe("Signatures complete: Treasury <script>");
    expect(template.html).toContain("Treasury &lt;script&gt;");
    expect(template.html).toContain("Pay &amp; deliver");
    expect(template.html).toContain("deadbeef");
    expect(template.text).toContain("Transaction hash: deadbeef");
    expect(template.text).toContain("2 of 2 required signatures collected");
  });

  it("says the transaction is ready to submit when there is no hash", () => {
    const template = renderThresholdReachedEmail({ ...base, txHash: null });
    expect(template.text).toContain("Ready to submit");
    expect(template.text).not.toContain("Transaction hash");
  });

  it("uses payload wording for signables", () => {
    const template = renderThresholdReachedEmail({
      ...base,
      resourceType: "signable",
    });
    expect(template.text).toContain("signable payload");
    expect(template.text).toContain("All required signatures have been collected.");
  });
});
