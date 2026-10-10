---
type: feature
area: Release & Production Health
state: delivered
owner: Quirin
milestone: 2026-08
prs: [319, 321, 369, 393]
updated: 2026-10-10
---

# Production Release Gap

Closed. The June and July backlog reached production with the 14 August release
(#369), and everything through mid-September with the 5 October release (#393); the
migration workflow reported success on both.

The underlying hazard has not gone away: the migration workflow only fires on pushes
to `main` touching `prisma/migrations/**` and never retries itself, so a failed run
still has to be noticed and dispatched by hand. Check its result on every release.

## Related

[[Migration Deploy Pipeline]] · [[Row-Level Security Hardening]] · [[Email Notification Center]] · [[Bot Registration & Claim Flow]]
