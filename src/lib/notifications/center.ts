import type { PrismaClient } from "@prisma/client";

import { env } from "@/env";
import {
  NOTIFICATION_EVENT_SIGNATURE_REQUIRED,
  NOTIFICATION_STATUS_PENDING,
  type NotificationEventType,
  type SignatureResourceType,
} from "./events";
import { createNotificationDelivery } from "./outbox";
import { resolveSignatureRecipients } from "./recipients";
import { renderSignatureRequiredEmail } from "./templates/signatureRequired";
import { drainNotificationOutbox } from "./worker";

type WalletNotificationShape = {
  id: string;
  name: string;
  signersAddresses: string[];
  numRequiredSigners: number | null;
  type: string;
};

export type EnqueueSignatureRequiredInput = {
  wallet: WalletNotificationShape;
  resourceType: SignatureResourceType;
  resourceId: string;
  signedAddresses?: string[];
  rejectedAddresses?: string[];
  creatorAddress?: string | null;
  description?: string | null;
  onlyRecipientAddress?: string | null;
  eventType?: NotificationEventType;
};

export function notificationsEmailEnabled(): boolean {
  return env.NOTIFICATIONS_EMAIL_ENABLED === "true";
}

export function getSiteUrl(): string {
  const baseUrl =
    env.NOTIFICATION_LINK_BASE_URL ??
    (env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : env.NEXT_PUBLIC_SITE_URL);

  return baseUrl.replace(/\/$/, "");
}

function getRequiredSignerCount(wallet: WalletNotificationShape): number {
  if (wallet.type === "any") return 1;
  if (wallet.type === "all") return wallet.signersAddresses.length;
  if (typeof wallet.numRequiredSigners === "number") {
    return wallet.numRequiredSigners;
  }
  return wallet.signersAddresses.length;
}

function actionPathFor(resourceType: SignatureResourceType, walletId: string) {
  return resourceType === "transaction"
    ? `/wallets/${walletId}/transactions`
    : `/wallets/${walletId}/signing`;
}

function signatureIdempotencyKey(args: {
  eventType: NotificationEventType;
  resourceType: SignatureResourceType;
  resourceId: string;
  walletId: string;
  recipientAddress: string;
}) {
  return [
    args.eventType,
    "email",
    args.resourceType,
    args.resourceId,
    args.walletId,
    args.recipientAddress,
  ].join(":");
}

export async function enqueueSignatureRequiredNotifications(
  db: PrismaClient,
  input: EnqueueSignatureRequiredInput,
) {
  const signedAddresses = input.signedAddresses ?? [];
  const rejectedAddresses = input.rejectedAddresses ?? [];
  const requiredCount = getRequiredSignerCount(input.wallet);

  if (signedAddresses.length >= requiredCount) {
    return [];
  }

  const eventType = input.eventType ?? NOTIFICATION_EVENT_SIGNATURE_REQUIRED;
  const siteUrl = getSiteUrl();
  const actionUrl = `${siteUrl}${actionPathFor(input.resourceType, input.wallet.id)}`;
  const preferencesUrl = `${siteUrl}/wallets/${input.wallet.id}/info`;
  const template = renderSignatureRequiredEmail({
    walletName: input.wallet.name,
    resourceType: input.resourceType,
    description: input.description ?? null,
    signedCount: signedAddresses.length,
    requiredCount,
    totalSigners: input.wallet.signersAddresses.length,
    actionUrl,
    preferencesUrl,
  });

  const recipients = await resolveSignatureRecipients(db, {
    walletId: input.wallet.id,
    signerAddresses: input.wallet.signersAddresses,
    resourceType: input.resourceType,
    signedAddresses,
    rejectedAddresses,
    creatorAddress: input.creatorAddress,
    onlyRecipientAddress: input.onlyRecipientAddress,
  });

  const payloadBase = {
    walletId: input.wallet.id,
    walletName: input.wallet.name,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    actionUrl,
    preferencesUrl,
    signedCount: signedAddresses.length,
    requiredCount,
    totalSigners: input.wallet.signersAddresses.length,
    description: input.description ?? null,
  };

  const deliveries = [];

  for (const recipient of recipients.eligible) {
    deliveries.push(
      await createNotificationDelivery(db, {
        eventType,
        recipientAddress: recipient.address,
        recipientEmail: recipient.email,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        walletId: input.wallet.id,
        idempotencyKey: signatureIdempotencyKey({
          eventType,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          walletId: input.wallet.id,
          recipientAddress: recipient.address,
        }),
        subject: template.subject,
        payload: {
          ...payloadBase,
          recipientAddress: recipient.address,
          html: template.html,
          text: template.text,
        },
        status: NOTIFICATION_STATUS_PENDING,
      }),
    );
  }

  for (const skipped of recipients.skipped) {
    deliveries.push(
      await createNotificationDelivery(db, {
        eventType,
        recipientAddress: skipped.address,
        recipientEmail: null,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        walletId: input.wallet.id,
        idempotencyKey: signatureIdempotencyKey({
          eventType,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          walletId: input.wallet.id,
          recipientAddress: skipped.address,
        }),
        subject: "Signature notification skipped",
        payload: {
          ...payloadBase,
          recipientAddress: skipped.address,
          skipReason: skipped.reason,
        },
        status: skipped.reason,
      }),
    );
  }

  if (notificationsEmailEnabled() && recipients.eligible.length > 0) {
    try {
      await drainNotificationOutbox(db, { limit: 10 });
    } catch (error) {
      console.error("Notification outbox drain failed", error);
    }
  }

  return deliveries;
}
