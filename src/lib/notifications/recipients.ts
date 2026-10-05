import type { PrismaClient } from "@prisma/client";

import {
  getSignatureNotificationPreferenceField,
  NOTIFICATION_STATUS_SKIPPED_DISABLED,
  NOTIFICATION_STATUS_SKIPPED_NO_EMAIL,
  NOTIFICATION_STATUS_SKIPPED_NOT_VERIFIED,
  NOTIFICATION_STATUS_SKIPPED_OPTED_OUT,
  type NotificationDeliveryStatus,
  type NotificationPreferenceField,
  type SignatureResourceType,
} from "./events";

export type SignatureRecipient = {
  address: string;
  email: string;
  emailNormalized: string;
};

export type SkippedSignatureRecipient = {
  address: string;
  reason: NotificationDeliveryStatus;
};

export type ResolveSignatureRecipientsInput = {
  walletId: string;
  signerAddresses: string[];
  resourceType: SignatureResourceType;
  signedAddresses?: string[];
  rejectedAddresses?: string[];
  creatorAddress?: string | null;
  onlyRecipientAddress?: string | null;
};

export type ResolveSignatureRecipientsResult = {
  eligible: SignatureRecipient[];
  skipped: SkippedSignatureRecipient[];
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type NotificationEligibilitySetting = {
  email: string | null;
  emailNormalized: string | null;
  emailVerifiedAt: Date | null;
  emailOptIn: boolean;
  notifyTransactionSignatures: boolean;
  notifySignableSignatures: boolean;
  notifyThresholdReached: boolean;
  notifyBallotDeadlines: boolean;
};

/** @deprecated alias kept for existing imports */
export type SignatureEligibilitySetting = NotificationEligibilitySetting;

/**
 * Single source of truth for whether a signer may receive a notification
 * email gated by `preferenceField`. Returns the skip status, or null when
 * eligible. Used both at enqueue time and at send time
 * (drainNotificationOutbox) so preference changes are honored for rows
 * already sitting in the outbox.
 */
export function getSkipReason(
  setting: NotificationEligibilitySetting | null | undefined,
  preferenceField: NotificationPreferenceField,
): NotificationDeliveryStatus | null {
  if (!setting?.email || !setting.emailNormalized) {
    return NOTIFICATION_STATUS_SKIPPED_NO_EMAIL;
  }
  if (!setting.emailVerifiedAt) {
    return NOTIFICATION_STATUS_SKIPPED_NOT_VERIFIED;
  }
  if (!setting.emailOptIn) {
    return NOTIFICATION_STATUS_SKIPPED_OPTED_OUT;
  }
  if (!setting[preferenceField]) {
    return NOTIFICATION_STATUS_SKIPPED_DISABLED;
  }
  return null;
}

export function getSignatureSkipReason(
  setting: NotificationEligibilitySetting | null | undefined,
  resourceType: SignatureResourceType,
): NotificationDeliveryStatus | null {
  return getSkipReason(
    setting,
    getSignatureNotificationPreferenceField(resourceType),
  );
}

export type ResolveWalletSignerRecipientsInput = {
  walletId: string;
  signerAddresses: string[];
  preferenceField: NotificationPreferenceField;
  /** Addresses that must not be notified (e.g. the signer who just acted). */
  excludeAddresses?: Array<string | null | undefined>;
};

/**
 * Resolves every wallet signer (minus `excludeAddresses`) to an eligible
 * recipient or a skip reason for the given preference. Unlike
 * resolveSignatureRecipients this does not drop the creator or signers who
 * already signed — it is the audience for informational events such as
 * threshold-reached and ballot-deadline reminders.
 */
export async function resolveWalletSignerRecipients(
  db: PrismaClient,
  input: ResolveWalletSignerRecipientsInput,
): Promise<ResolveSignatureRecipientsResult> {
  const excluded = new Set(
    (input.excludeAddresses ?? []).filter(
      (address): address is string => typeof address === "string" && !!address,
    ),
  );
  const candidateAddresses = Array.from(new Set(input.signerAddresses)).filter(
    (address) => !excluded.has(address),
  );

  if (candidateAddresses.length === 0) {
    return { eligible: [], skipped: [] };
  }

  const settings = await db.walletSignerNotificationSetting.findMany({
    where: {
      walletId: input.walletId,
      signerAddress: { in: candidateAddresses },
    },
  });
  const settingsByAddress = new Map(
    settings.map((setting) => [setting.signerAddress, setting]),
  );

  const eligible: SignatureRecipient[] = [];
  const skipped: SkippedSignatureRecipient[] = [];

  for (const address of candidateAddresses) {
    const setting = settingsByAddress.get(address);
    const skipReason = getSkipReason(setting, input.preferenceField);
    if (skipReason) {
      skipped.push({ address, reason: skipReason });
      continue;
    }

    eligible.push({
      address,
      email: setting!.email!,
      emailNormalized: setting!.emailNormalized!,
    });
  }

  return { eligible, skipped };
}

export async function resolveSignatureRecipients(
  db: PrismaClient,
  input: ResolveSignatureRecipientsInput,
): Promise<ResolveSignatureRecipientsResult> {
  const signed = new Set(input.signedAddresses ?? []);
  const rejected = new Set(input.rejectedAddresses ?? []);
  const creator = input.creatorAddress ?? null;
  const signerSet = new Set(input.signerAddresses);

  const candidateAddresses = input.signerAddresses.filter((address) => {
    if (input.onlyRecipientAddress && address !== input.onlyRecipientAddress) {
      return false;
    }
    if (address === creator) return false;
    if (signed.has(address)) return false;
    if (rejected.has(address)) return false;
    return true;
  });

  if (
    input.onlyRecipientAddress &&
    !signerSet.has(input.onlyRecipientAddress)
  ) {
    return { eligible: [], skipped: [] };
  }

  if (candidateAddresses.length === 0) {
    return { eligible: [], skipped: [] };
  }

  const settings = await db.walletSignerNotificationSetting.findMany({
    where: {
      walletId: input.walletId,
      signerAddress: { in: candidateAddresses },
    },
  });
  const settingsByAddress = new Map(
    settings.map((setting) => [setting.signerAddress, setting]),
  );

  const eligible: SignatureRecipient[] = [];
  const skipped: SkippedSignatureRecipient[] = [];

  for (const address of candidateAddresses) {
    const setting = settingsByAddress.get(address);
    const skipReason = getSignatureSkipReason(setting, input.resourceType);
    if (skipReason) {
      skipped.push({ address, reason: skipReason });
      continue;
    }

    eligible.push({
      address,
      email: setting!.email!,
      emailNormalized: setting!.emailNormalized!,
    });
  }

  return { eligible, skipped };
}
