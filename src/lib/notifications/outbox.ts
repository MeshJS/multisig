import type { Prisma, PrismaClient } from "@prisma/client";

import {
  NOTIFICATION_CHANNEL_EMAIL,
  NOTIFICATION_STATUS_PENDING,
  type NotificationDeliveryStatus,
  type NotificationEventType,
  type NotificationResourceType,
} from "./events";

export type CreateNotificationDeliveryInput = {
  eventType: NotificationEventType;
  recipientAddress: string;
  recipientEmail?: string | null;
  resourceType: NotificationResourceType;
  resourceId: string;
  walletId?: string | null;
  idempotencyKey: string;
  subject: string;
  payload: Prisma.InputJsonObject;
  status?: NotificationDeliveryStatus;
  nextAttemptAt?: Date;
};

export async function createNotificationDelivery(
  db: PrismaClient,
  input: CreateNotificationDeliveryInput,
) {
  return db.notificationDelivery.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      eventType: input.eventType,
      channel: NOTIFICATION_CHANNEL_EMAIL,
      recipientAddress: input.recipientAddress,
      recipientEmail: input.recipientEmail ?? null,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      walletId: input.walletId ?? null,
      idempotencyKey: input.idempotencyKey,
      subject: input.subject,
      payload: input.payload,
      status: input.status ?? NOTIFICATION_STATUS_PENDING,
      nextAttemptAt: input.nextAttemptAt ?? new Date(),
    },
  });
}
