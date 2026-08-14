export const NOTIFICATION_CHANNEL_EMAIL = "email" as const;

export const NOTIFICATION_EVENT_EMAIL_VERIFY = "email.verify" as const;
export const NOTIFICATION_EVENT_SIGNATURE_REQUIRED =
  "signature.required" as const;
export const NOTIFICATION_EVENT_SIGNATURE_REMINDER =
  "signature.reminder" as const;

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
  | typeof NOTIFICATION_EVENT_SIGNATURE_REMINDER;

export type NotificationResourceType = "transaction" | "signable" | "wallet";

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

export function getSignatureNotificationPreferenceField(
  resourceType: SignatureResourceType,
) {
  return resourceType === "transaction"
    ? "notifyTransactionSignatures"
    : "notifySignableSignatures";
}
