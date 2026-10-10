import type {
  PrismaClient,
  WalletSignerNotificationSetting,
} from "@prisma/client";

import {
  getNotificationPreferenceField,
  NOTIFICATION_STATUS_FAILED,
  NOTIFICATION_STATUS_PENDING,
  NOTIFICATION_STATUS_RETRYING,
  NOTIFICATION_STATUS_SENDING,
  NOTIFICATION_STATUS_SENT,
  type NotificationPreferenceField,
} from "./events";
import { getSkipReason } from "./recipients";
import { sendEmailViaResend } from "./channels/email/resend";

const RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
];
const MAX_ATTEMPTS = 5;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function getNextAttemptAt(attempts: number): Date {
  const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]!;
  return new Date(Date.now() + delay);
}

function getPayloadString(
  payload: unknown,
  key: "html" | "text",
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

// Preference-gated deliveries re-check the signer's current settings at send
// time so a toggle flipped after enqueue is still honored. Returns null for
// exempt events (email.verify must be able to reach an address that is not
// yet opted in or verified) and for rows without a wallet scope.
function preferenceFieldFor(delivery: {
  eventType: string;
  walletId: string | null;
  resourceType: string;
}): NotificationPreferenceField | null {
  if (!delivery.walletId) return null;
  return getNotificationPreferenceField(
    delivery.eventType,
    delivery.resourceType,
  );
}

export async function drainNotificationOutbox(
  db: PrismaClient,
  options: { limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const now = new Date();
  const deliveries = await db.notificationDelivery.findMany({
    where: {
      status: { in: [NOTIFICATION_STATUS_PENDING, NOTIFICATION_STATUS_RETRYING] },
      nextAttemptAt: { lte: now },
      recipientEmail: { not: null },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const gatedDeliveries = deliveries.filter(
    (delivery) => preferenceFieldFor(delivery) !== null,
  );
  const settingsByKey = new Map<string, WalletSignerNotificationSetting>();
  if (gatedDeliveries.length > 0) {
    const settings = await db.walletSignerNotificationSetting.findMany({
      where: {
        OR: gatedDeliveries.map((delivery) => ({
          walletId: delivery.walletId!,
          signerAddress: delivery.recipientAddress,
        })),
      },
    });
    for (const setting of settings) {
      settingsByKey.set(`${setting.walletId}:${setting.signerAddress}`, setting);
    }
  }

  const results = [];

  for (const delivery of deliveries) {
    const preferenceField = preferenceFieldFor(delivery);
    if (preferenceField) {
      const setting = settingsByKey.get(
        `${delivery.walletId}:${delivery.recipientAddress}`,
      );
      const skipReason = getSkipReason(setting, preferenceField);
      if (skipReason) {
        const marked = await db.notificationDelivery.updateMany({
          where: {
            id: delivery.id,
            status: delivery.status,
          },
          data: {
            status: skipReason,
            lastError: null,
          },
        });
        if (marked.count > 0) {
          results.push({ ...delivery, status: skipReason, lastError: null });
        }
        continue;
      }
    }

    const claimed = await db.notificationDelivery.updateMany({
      where: {
        id: delivery.id,
        status: delivery.status,
      },
      data: {
        status: NOTIFICATION_STATUS_SENDING,
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    if (claimed.count === 0) {
      continue;
    }

    const attempts = delivery.attempts + 1;
    const html = getPayloadString(delivery.payload, "html");
    const text = getPayloadString(delivery.payload, "text");

    try {
      if (!delivery.recipientEmail || !html || !text) {
        throw new Error("Delivery is missing recipient or rendered email body");
      }

      const sent = await sendEmailViaResend({
        to: delivery.recipientEmail,
        subject: delivery.subject,
        html,
        text,
      });

      const updated = await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NOTIFICATION_STATUS_SENT,
          provider: sent.provider,
          providerMessageId: sent.messageId,
          sentAt: new Date(),
          lastError: null,
        },
      });
      results.push(updated);
    } catch (error) {
      const err = toError(error);
      const willRetry = attempts < MAX_ATTEMPTS;
      const updated = await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: willRetry
            ? NOTIFICATION_STATUS_RETRYING
            : NOTIFICATION_STATUS_FAILED,
          lastError: err.message.slice(0, 1000),
          nextAttemptAt: willRetry ? getNextAttemptAt(attempts) : new Date(),
        },
      });
      results.push(updated);
    }
  }

  return results;
}
