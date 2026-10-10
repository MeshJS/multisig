---
type: feature
area: Reliability & CI
state: delivered
owner: Andre
milestone: 2026-07
prs: [323, 335, 336]
updated: 2026-07-27
---

# Playwright E2E Suite

Eleven spec files and roughly 54 browser tests covering wallet creation for legacy
and SDK wallets, real preprod ring transfers, staking, proxy, DRep and ballot UI,
bot management, notification settings, wallet access control, signing rejection and
responsive overflow. Runs in Docker, serialized against the smoke job through a
shared concurrency group. Unscheduled work that became the safety net Document
Sign-Off will ship against.

## Related

[[Real-Chain Smoke Tests]] · [[Transaction Builder & tRPC Tests]] · [[Document Sign-Off MVP]]
