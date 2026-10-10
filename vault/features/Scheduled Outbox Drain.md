---
type: feature
area: Notifications
state: planned
owner: Andre
milestone: 2026-08
issues: [327]
updated: 2026-07-27
---

# Scheduled Outbox Drain

The outbox exists and the drain endpoint exists, but nothing calls it on a schedule —
the daily balance snapshot is the only cron in the repository. Until this lands,
queued notifications sit undelivered.

## Related

[[Notification Outbox & Worker]] · [[Email Notification Center]] · [[Notification Digests & Reminders]]
