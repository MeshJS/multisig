# Notification Center Implementation Plan

## Goal

Build a reusable notification center that can send email notifications when a wallet signer needs to act, starting with "signature required" notifications for pending multisig transactions and signable datum payloads.

The first channel will be email via Resend. A signer only receives email if they have provided and verified an email address, so notification delivery is opt-in and does not block wallet or transaction creation.

## Current Codebase Context

- Wallet signer data is currently stored as parallel arrays on `Wallet` and `NewWallet` in `prisma/schema.prisma`: `signersAddresses`, `signersStakeKeys`, `signersDRepKeys`, and `signersDescriptions`.
- User records in `User` are keyed by wallet `address` and currently include `stakeAddress`, `drepKeyHash`, optional `nostrKey`, and `discordId`, but no email field.
- Pending transaction creation happens in multiple places:
  - `src/hooks/useTransaction.ts` for in-app transaction creation.
  - `src/server/api/routers/transactions.ts` for tRPC create/import.
  - `src/lib/server/createPendingMultisigTransaction.ts` for server/API/bot/proxy transaction builders.
  - `src/pages/api/v1/addTransaction.ts` for external transaction submission.
- Pending datum/signable creation happens through:
  - `src/server/api/routers/signable.ts`.
  - `src/pages/api/v1/submitDatum.ts`.
- Existing reminders are Discord-only and client-triggered:
  - `src/components/pages/wallet/transactions/transaction-card.tsx`.
  - `src/components/pages/wallet/signing/signable-card.tsx`.
  - `src/components/pages/wallet/new-transaction/index.tsx`.
- Existing observability uses append-only `AuditLog`; notification delivery should follow the same audit-friendly posture.

## Design Principles

- Reusable first: notification orchestration should not know about Resend directly.
- Server-owned delivery: do not send transactional notifications from React components.
- Non-blocking: transaction/signable creation should succeed even if notification dispatch fails.
- Idempotent: one event-recipient-channel combination should not send duplicate emails.
- Consent-aware: only verified or explicit opt-in email addresses receive messages.
- Email-client realistic: HTML emails should include a plain text fallback and avoid decorative assets in the first version.

## Phase 1: Email Identity and Preferences

### Data model

Add signer notification metadata without adding more parallel arrays to `Wallet`.

Recommended Prisma models:

```prisma
model SignerNotificationProfile {
  id              String    @id @default(cuid())
  address         String    @unique
  email           String?
  emailNormalized String?
  emailVerifiedAt DateTime?
  emailOptIn      Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([emailNormalized])
}

model NotificationPreference {
  id          String   @id @default(cuid())
  address     String
  eventType   String
  channel     String
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([address, eventType, channel])
  @@index([address])
}
```

Optional later model if wallet-specific routing is needed:

```prisma
model WalletSignerNotificationSetting {
  walletId      String
  signerAddress String
  eventType     String
  channel       String
  enabled       Boolean @default(true)

  @@id([walletId, signerAddress, eventType, channel])
  @@index([signerAddress])
  @@index([walletId])
}
```

Why not add `signersEmails String[]`:

- The existing signer arrays already need index alignment. Adding another parallel array would make wallet updates and imports more fragile.
- Email belongs to a signer identity and can be reused across wallets.
- Verification, opt-in, and unsubscribe state do not belong in `Wallet`.

### User model relationship

Do not rely only on `User.email`.

`User` is only present for onboarded wallet users. Some signers can exist in wallet arrays before they have joined or created a user record. `SignerNotificationProfile` lets the notification center resolve email by signer address even before a full `User` profile exists.

If desired, add `email` and `emailVerifiedAt` to `User` too, but treat `SignerNotificationProfile` as the delivery source of truth and keep it synchronized when the current user changes email.

### Email verification

Add a simple verification token model:

```prisma
model EmailVerificationToken {
  id            String    @id @default(cuid())
  address       String
  emailNormalized String
  tokenHash     String    @unique
  expiresAt     DateTime
  consumedAt    DateTime?
  createdAt     DateTime  @default(now())

  @@index([address])
  @@index([expiresAt])
}
```

Flow:

1. Signer enters an email in their user/profile page or during invite acceptance.
2. Server validates and normalizes it.
3. Server stores a pending token hash and sends a verification email.
4. Clicking `/api/notifications/email/verify?token=...` sets `emailVerifiedAt`.
5. Only verified emails are eligible for signature-required notifications.

## Phase 2: Notification Outbox

Add an outbox so notification creation and notification delivery are separate concerns.

Recommended Prisma model:

```prisma
model NotificationDelivery {
  id             String    @id @default(cuid())
  eventType      String
  channel        String
  recipientAddress String
  recipientEmail String?
  resourceType   String
  resourceId     String
  walletId       String?
  idempotencyKey String    @unique
  subject        String
  payload        Json
  status         String    @default("pending")
  provider       String?
  providerMessageId String?
  attempts       Int       @default(0)
  lastError      String?
  nextAttemptAt  DateTime  @default(now())
  sentAt         DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([status, nextAttemptAt])
  @@index([recipientAddress])
  @@index([walletId])
  @@index([resourceType, resourceId])
}
```

Postgres notes:

- Keep `idempotencyKey` unique so retries and concurrent trigger paths cannot duplicate sends.
- Index `status, nextAttemptAt` because the worker/drain endpoint will repeatedly query pending rows.
- Index recipient, wallet, and resource columns because the notification center UI will filter by those fields.
- Consider a partial index for pending rows in a SQL migration if Prisma does not express the exact desired index well:

```sql
create index "NotificationDelivery_pending_idx"
on "NotificationDelivery" ("nextAttemptAt", "createdAt")
where "status" in ('pending', 'retrying');
```

## Phase 3: Notification Library Layout

Create a reusable module under `src/lib/notifications/`.

Recommended structure:

```text
src/lib/notifications/
  center.ts
  events.ts
  recipients.ts
  outbox.ts
  templates/
    shared.ts
    signatureRequired.ts
    verifyEmail.ts
  channels/
    email/
      resend.ts
      types.ts
  worker.ts
```

Responsibilities:

- `events.ts`: event names, payload types, and resource metadata.
- `recipients.ts`: resolve signer addresses to verified email profiles and preferences.
- `outbox.ts`: create idempotent `NotificationDelivery` rows.
- `center.ts`: public API used by wallet, transaction, signable, and future features.
- `templates/*`: pure functions that return `{ subject, html, text }`.
- `channels/email/resend.ts`: the only place that imports the Resend SDK.
- `worker.ts`: drains pending deliveries, handles retry/backoff, and records provider responses.

Public API sketch:

```ts
await notificationCenter.enqueueSignatureRequired({
  walletId,
  walletName,
  resourceType: "transaction",
  resourceId: transaction.id,
  requiredSignerAddresses,
  alreadySignedAddresses,
  createdByAddress,
  actionUrl,
  description,
});
```

The reusable lower-level API should support future features:

```ts
await notificationCenter.enqueue({
  eventType: "signature.required",
  channel: "email",
  recipientAddress,
  resourceType,
  resourceId,
  walletId,
  payload,
});
```

## Phase 4: Resend Integration

Install:

```bash
npm install resend
```

Add server env vars in `src/env.js` and `.env.example`:

```text
RESEND_API_KEY=
EMAIL_FROM="Mesh Multisig <notifications@your-domain.example>"
EMAIL_REPLY_TO=
NOTIFICATION_DRAIN_SECRET=
```

Implementation details:

- Use `new Resend(env.RESEND_API_KEY)` inside `src/lib/notifications/channels/email/resend.ts`.
- Send with `from`, `to`, `subject`, `html`, and `text`.
- Store Resend's returned message id on `NotificationDelivery.providerMessageId`.
- Use outbox-level idempotency before provider calls. If the Resend SDK supports passing an HTTP idempotency header in the current version at implementation time, also pass the delivery idempotency key to Resend.
- Tag messages when possible with stable ASCII tags such as `event:signature_required`, `resource:transaction`, and `wallet:<walletId-short>` for provider-side filtering.

## Phase 5: Signature Required Triggering

### Recipient resolver

For each wallet action, compute:

```ts
requiredSignerAddresses =
  wallet.signersAddresses
    .filter((address) => !signedAddresses.includes(address))
    .filter((address) => !rejectedAddresses.includes(address))
    .filter((address) => address !== createdByAddress);
```

Notes:

- For `type === "any"` or `numRequiredSigners === 1`, there may be no pending notification because the transaction can submit immediately.
- For `atLeast`, notify unsigned signers until the threshold is met. After threshold completion and submission, do not send further reminders.
- For `all`, notify every unsigned signer.

### Hook points

Add notification enqueue calls after a pending row is successfully created.

Primary hook points:

- `src/lib/server/createPendingMultisigTransaction.ts`: notify for server-built pending transactions used by bot, proxy, staking, governance, and v1 flows.
- `src/server/api/routers/transactions.ts`: notify for tRPC-created and imported pending transactions. Longer term, consider routing all creation through the server helper so this is not duplicated.
- `src/pages/api/v1/addTransaction.ts`: if it does not route through the helper in every pending path, add notification enqueue after DB create.
- `src/server/api/routers/signable.ts`: notify for `createSignable` when `state === 0`.
- `src/pages/api/v1/submitDatum.ts`: notify for API-created `Signable` rows.

Avoid adding new email logic to:

- `src/components/pages/wallet/new-transaction/index.tsx`
- `src/components/pages/wallet/transactions/transaction-card.tsx`
- `src/components/pages/wallet/signing/signable-card.tsx`

Those should eventually call a server "send reminder" mutation or endpoint if manual reminders remain.

## Phase 6: Notification Center UI

Add a notification/preferences section to `src/pages/user/index.tsx`.

Minimum UI:

- Email address field.
- Verification status.
- "Send verification email" action.
- Channel preferences:
  - Signature required for transactions.
  - Signature required for datum/signable payloads.
- Opt out action.

Add a wallet-level notification center later under wallet info if needed:

- Show which signers have email enabled without revealing full emails to other signers.
- Show delivery status for recent notifications:
  - pending
  - sent
  - retrying
  - failed
  - skipped-no-email
  - skipped-not-verified
  - skipped-opted-out

## Phase 7: Email Template Design

Use HTML emails with table-safe layout and inline styles.

Template requirements:

- `subject`: clear and action-oriented, for example `Signature required: <wallet name>`.
- `text`: plain text fallback with wallet name, action link, and why the user is receiving it.
- `html`: branded transactional email with:
  - wallet name
  - resource type
  - transaction/signable description if present
  - signer progress, for example `1 of 3 signatures collected`
  - CTA button to open `/wallets/<walletId>/transactions` or `/wallets/<walletId>/signing`
  - unsubscribe/preferences link

Keep the first version simple:

- Use HTML and inline CSS only.
- Do not include animated SVGs or embedded SVG markup.
- Do not include JavaScript or external decorative assets.
- Keep all critical CTA content as readable HTML text/buttons.
- Test in Gmail, Apple Mail, and Outlook before production rollout.

Suggested template files:

```text
src/lib/notifications/templates/signatureRequired.ts
src/lib/notifications/templates/verifyEmail.ts
src/lib/notifications/templates/shared.ts
```

## Phase 8: Delivery Worker

Start simple:

- After enqueueing notifications, call a best-effort `drainNotificationOutbox({ limit: 10 })` server-side.
- Add `src/pages/api/notifications/drain.ts` protected by `NOTIFICATION_DRAIN_SECRET`.
- Configure a scheduled job later to call the drain endpoint every few minutes.

Retry behavior:

- Attempt 1 immediately.
- Retry after 5 minutes, 30 minutes, then 2 hours.
- Mark `failed` after a small max attempt count, for example 5.
- Store short error strings only; do not store provider secrets or full request bodies.

## Phase 9: Manual Reminders

Replace Discord-only client reminders with a server endpoint/mutation:

```ts
api.notification.sendSignatureReminder.useMutation(...)
```

Rules:

- Caller must be a wallet signer or owner.
- Recipient must be a wallet signer.
- Recipient must still need to sign.
- Apply rate limits per `walletId + resourceId + recipientAddress`.
- Enqueue `signature.reminder` using the same channel/template stack.

Keep Discord as optional later channel if desired, but route it through the same notification center rather than calling `sendDiscordMessage` directly from components.

## Phase 10: Testing

Unit tests:

- recipient resolution excludes already signed, rejected, and creator addresses.
- unverified email is skipped.
- opted-out signer is skipped.
- idempotency key prevents duplicate delivery rows.
- email templates escape dynamic values and include text fallback.

Integration tests:

- pending tRPC transaction creates notification deliveries.
- server-built pending transaction through `createPendingMultisigTransaction` creates notification deliveries.
- `submitDatum` creates signable notification deliveries.
- drain worker calls the Resend adapter once per pending delivery and records message ids.
- Resend failure moves row to retrying without breaking transaction creation.

Manual QA:

- Create a 2-of-3 wallet with one signer email verified and one missing email.
- Create a pending transaction.
- Confirm one email delivery and one skipped/no-email outcome.
- Sign with another signer until threshold is met.
- Confirm no more signature-required notifications are created.
- Open the email in Gmail, Apple Mail, and Outlook.

## Phase 11: Rollout

1. Add schema and env validation.
2. Add profile/preference UI and email verification.
3. Add outbox and Resend adapter behind feature flag `NOTIFICATIONS_EMAIL_ENABLED`.
4. Add transaction/signable enqueue hooks.
5. Enable drain endpoint in staging.
6. Send test notifications from staging domain.
7. Enable production for verified internal/test signers.
8. Remove or migrate client-side Discord reminder calls after email path is stable.

## Open Questions

- Should wallet creators be allowed to enter another signer's email, or should emails only be entered and verified by the signer themselves?
- Should emails be global per signer address or configurable per wallet?
- Should notification history be visible to all wallet signers or only to the recipient/current user?
- What production sending domain should be verified in Resend?
- Should Discord remain as a supported channel after email launches?

## External References

- Resend Node.js quickstart: https://resend.com/docs/send-with-nodejs
- Resend Send Email API: https://resend.com/docs/api-reference/emails/send-email
