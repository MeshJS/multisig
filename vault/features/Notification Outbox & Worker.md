---
type: feature
area: Notifications
state: delivered
owner: Andre
milestone: 2026-06
updated: 2026-07-27
---

# Notification Outbox & Worker

A real outbox rather than fire-and-forget sending: every delivery carries an
idempotency key, an attempt counter and a retry backoff, across nine statuses that
include four distinct skip reasons — no email, not verified, opted out, disabled.
Drained by a token-authenticated endpoint.

## Related

[[Email Notification Center]] · [[Scheduled Outbox Drain]] · [[Notification Digests & Reminders]]
