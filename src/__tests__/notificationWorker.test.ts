import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/notifications/channels/email/resend", () => ({
  sendEmailViaResend: jest.fn(async () => ({
    provider: "resend",
    messageId: "msg_1",
  })),
}));

import {
  NOTIFICATION_EVENT_BALLOT_DEADLINE,
  NOTIFICATION_EVENT_EMAIL_VERIFY,
  NOTIFICATION_EVENT_SIGNATURE_REQUIRED,
  NOTIFICATION_EVENT_THRESHOLD_REACHED,
  NOTIFICATION_STATUS_PENDING,
  NOTIFICATION_STATUS_SKIPPED_OPTED_OUT,
} from "@/lib/notifications/events";
import { drainNotificationOutbox } from "@/lib/notifications/worker";
import { sendEmailViaResend } from "@/lib/notifications/channels/email/resend";

const sendMock = sendEmailViaResend as jest.MockedFunction<
  typeof sendEmailViaResend
>;

function makeDelivery(overrides: Record<string, unknown>) {
  return {
    id: "delivery_1",
    eventType: NOTIFICATION_EVENT_SIGNATURE_REQUIRED,
    channel: "email",
    recipientAddress: "addr_1",
    recipientEmail: "one@example.com",
    resourceType: "transaction",
    resourceId: "res_1",
    walletId: "wallet_1",
    subject: "Signature required",
    payload: { html: "<p>sign</p>", text: "sign" },
    status: NOTIFICATION_STATUS_PENDING,
    attempts: 0,
    nextAttemptAt: new Date(0),
    ...overrides,
  };
}

function makeSetting(overrides: Record<string, unknown>) {
  return {
    walletId: "wallet_1",
    signerAddress: "addr_1",
    email: "one@example.com",
    emailNormalized: "one@example.com",
    emailVerifiedAt: new Date(),
    emailOptIn: true,
    notifyTransactionSignatures: true,
    notifySignableSignatures: true,
    notifyThresholdReached: true,
    notifyBallotDeadlines: true,
    ...overrides,
  };
}

function makeDb(deliveries: unknown[], settings: unknown[]) {
  return {
    notificationDelivery: {
      findMany: jest.fn(async () => deliveries),
      updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })),
      update: jest.fn(
        async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
          id: args.where.id,
          ...args.data,
        }),
      ),
    },
    walletSignerNotificationSetting: {
      findMany: jest.fn(async () => settings),
    },
  };
}

describe("drainNotificationOutbox preference re-check", () => {
  beforeEach(() => {
    sendMock.mockClear();
  });

  it("skips a queued signature email when the signer has since opted out", async () => {
    const delivery = makeDelivery({ id: "delivery_opted_out" });
    const db = makeDb([delivery], [makeSetting({ emailOptIn: false })]);

    const results = await drainNotificationOutbox(db as any);

    expect(sendMock).not.toHaveBeenCalled();
    expect(db.notificationDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: "delivery_opted_out", status: NOTIFICATION_STATUS_PENDING },
      data: { status: NOTIFICATION_STATUS_SKIPPED_OPTED_OUT, lastError: null },
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "delivery_opted_out",
      status: NOTIFICATION_STATUS_SKIPPED_OPTED_OUT,
    });
  });

  it("still sends when the signer remains fully eligible", async () => {
    const delivery = makeDelivery({ id: "delivery_eligible" });
    const db = makeDb([delivery], [makeSetting({})]);

    const results = await drainNotificationOutbox(db as any);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      to: "one@example.com",
      subject: "Signature required",
      html: "<p>sign</p>",
      text: "sign",
    });
    expect(results[0]).toMatchObject({
      id: "delivery_eligible",
      status: "sent",
    });
  });

  it("sends verification emails regardless of opt-in state", async () => {
    const delivery = makeDelivery({
      id: "delivery_verify",
      eventType: NOTIFICATION_EVENT_EMAIL_VERIFY,
      resourceType: "wallet",
    });
    const db = makeDb(
      [delivery],
      [makeSetting({ emailOptIn: false, emailVerifiedAt: null })],
    );

    const results = await drainNotificationOutbox(db as any);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({
      id: "delivery_verify",
      status: "sent",
    });
  });

  it("skips per-type disabled deliveries for signable resources", async () => {
    const delivery = makeDelivery({
      id: "delivery_signable",
      resourceType: "signable",
    });
    const db = makeDb(
      [delivery],
      [makeSetting({ notifySignableSignatures: false })],
    );

    const results = await drainNotificationOutbox(db as any);

    expect(sendMock).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      id: "delivery_signable",
      status: "skipped_disabled",
    });
  });

  it("skips a threshold-reached delivery when that toggle is off", async () => {
    const delivery = makeDelivery({
      id: "delivery_threshold",
      eventType: NOTIFICATION_EVENT_THRESHOLD_REACHED,
    });
    const db = makeDb(
      [delivery],
      [makeSetting({ notifyThresholdReached: false })],
    );

    const results = await drainNotificationOutbox(db as any);

    expect(sendMock).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      id: "delivery_threshold",
      status: "skipped_disabled",
    });
  });

  it("still sends a threshold-reached delivery when only signature toggles are off", async () => {
    const delivery = makeDelivery({
      id: "delivery_threshold_ok",
      eventType: NOTIFICATION_EVENT_THRESHOLD_REACHED,
    });
    const db = makeDb(
      [delivery],
      [
        makeSetting({
          notifyTransactionSignatures: false,
          notifySignableSignatures: false,
        }),
      ],
    );

    const results = await drainNotificationOutbox(db as any);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({
      id: "delivery_threshold_ok",
      status: "sent",
    });
  });

  it("skips a ballot-deadline delivery when that toggle is off", async () => {
    const delivery = makeDelivery({
      id: "delivery_ballot",
      eventType: NOTIFICATION_EVENT_BALLOT_DEADLINE,
      resourceType: "ballot",
    });
    const db = makeDb(
      [delivery],
      [makeSetting({ notifyBallotDeadlines: false })],
    );

    const results = await drainNotificationOutbox(db as any);

    expect(sendMock).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      id: "delivery_ballot",
      status: "skipped_disabled",
    });
  });

  it("gates transaction-keyed ballot-deadline deliveries by the same toggle", async () => {
    const delivery = makeDelivery({
      id: "delivery_ballot_tx",
      eventType: NOTIFICATION_EVENT_BALLOT_DEADLINE,
      resourceType: "transaction",
    });
    const db = makeDb(
      [delivery],
      [makeSetting({ notifyBallotDeadlines: false })],
    );

    const results = await drainNotificationOutbox(db as any);

    expect(sendMock).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      id: "delivery_ballot_tx",
      status: "skipped_disabled",
    });
  });

  it("treats a missing settings row as no email at send time", async () => {
    const delivery = makeDelivery({ id: "delivery_missing" });
    const db = makeDb([delivery], []);

    const results = await drainNotificationOutbox(db as any);

    expect(sendMock).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      id: "delivery_missing",
      status: "skipped_no_email",
    });
  });
});
