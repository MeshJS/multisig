export const NOTIFICATION_CHANNEL_EMAIL = "email" as const;

export const NOTIFICATION_EVENT_EMAIL_VERIFY = "email.verify" as const;
export const NOTIFICATION_EVENT_SIGNATURE_REQUIRED =
  "signature.required" as const;
export const NOTIFICATION_EVENT_SIGNATURE_REMINDER =
  "signature.reminder" as const;
export const NOTIFICATION_EVENT_THRESHOLD_REACHED =
  "threshold.reached" as const;
export const NOTIFICATION_EVENT_BALLOT_DEADLINE = "ballot.deadline" as const;

export const NOTIFICATION_STATUS_PENDING = "pending" as const;
export const NOTIFICATION_STATUS_RETRYING = "retrying" as const;
export const NOTIFICATION_STATUS_SENDING = "sending" as const;
export const NOTIFICATION_STATUS_SENT = "sent" as const;
export const NOTIFICATION_STATUS_FAILED = "failed" as const;
export const NOTIFICATION_STATUS_SKIPPED_NO_EMAIL = "skipped_no_email" as const;
export const NOTIFICATION_STATUS_SKIPPED_NOT_VERIFIED =
  "skipped_not_verified" as const;
export const NOTIFICATION_STATUS_SKIPPED_OPTED_OUT =
  "skipped_opted_out" as const;
export const NOTIFICATION_STATUS_SKIPPED_DISABLED =
  "skipped_disabled" as const;

export type NotificationEventType =
  | typeof NOTIFICATION_EVENT_EMAIL_VERIFY
  | typeof NOTIFICATION_EVENT_SIGNATURE_REQUIRED
  | typeof NOTIFICATION_EVENT_SIGNATURE_REMINDER
  | typeof NOTIFICATION_EVENT_THRESHOLD_REACHED
  | typeof NOTIFICATION_EVENT_BALLOT_DEADLINE;

export type NotificationResourceType =
  | "transaction"
  | "signable"
  | "wallet"
  | "ballot";

export type SignatureResourceType = Extract<
  NotificationResourceType,
  "transaction" | "signable"
>;

export type NotificationDeliveryStatus =
  | typeof NOTIFICATION_STATUS_PENDING
  | typeof NOTIFICATION_STATUS_RETRYING
  | typeof NOTIFICATION_STATUS_SENDING
  | typeof NOTIFICATION_STATUS_SENT
  | typeof NOTIFICATION_STATUS_FAILED
  | typeof NOTIFICATION_STATUS_SKIPPED_NO_EMAIL
  | typeof NOTIFICATION_STATUS_SKIPPED_NOT_VERIFIED
  | typeof NOTIFICATION_STATUS_SKIPPED_OPTED_OUT
  | typeof NOTIFICATION_STATUS_SKIPPED_DISABLED;

/**
 * Column on WalletSignerNotificationSetting that gates a given event type.
 */
export type NotificationPreferenceField =
  | "notifyTransactionSignatures"
  | "notifySignableSignatures"
  | "notifyThresholdReached"
  | "notifyBallotDeadlines";

export function isSignatureResourceType(
  value: string,
): value is SignatureResourceType {
  return value === "transaction" || value === "signable";
}

export function getSignatureNotificationPreferenceField(
  resourceType: SignatureResourceType,
): NotificationPreferenceField {
  return resourceType === "transaction"
    ? "notifyTransactionSignatures"
    : "notifySignableSignatures";
}

/**
 * Maps a delivery's (eventType, resourceType) to the preference column that
 * must be on for it to be sent. Returns null for events that are exempt from
 * preference checks (email.verify must reach an address that has not opted in
 * or verified yet) and for unknown combinations.
 */
export function getNotificationPreferenceField(
  eventType: string,
  resourceType: string,
): NotificationPreferenceField | null {
  switch (eventType) {
    case NOTIFICATION_EVENT_SIGNATURE_REQUIRED:
    case NOTIFICATION_EVENT_SIGNATURE_REMINDER:
      return isSignatureResourceType(resourceType)
        ? getSignatureNotificationPreferenceField(resourceType)
        : null;
    case NOTIFICATION_EVENT_THRESHOLD_REACHED:
      return isSignatureResourceType(resourceType)
        ? "notifyThresholdReached"
        : null;
    case NOTIFICATION_EVENT_BALLOT_DEADLINE:
      // Deadline reminders are keyed on a ballot or on a pending vote
      // transaction; both are gated by the same toggle.
      return resourceType === "ballot" || resourceType === "transaction"
        ? "notifyBallotDeadlines"
        : null;
    default:
      return null;
  }
}
