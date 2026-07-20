import type { PrismaClient } from "@prisma/client";

import {
  NOTIFICATION_STATUS_FAILED,
  NOTIFICATION_STATUS_PENDING,
  NOTIFICATION_STATUS_RETRYING,
  NOTIFICATION_STATUS_SENDING,
  NOTIFICATION_STATUS_SENT,
} from "./events";
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

  const results = [];

  for (const delivery of deliveries) {
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
