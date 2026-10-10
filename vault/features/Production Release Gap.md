---
type: feature
area: Release & Production Health
state: blocked
owner: Quirin
milestone: 2026-08
prs: [319, 321]
updated: 2026-07-27
---

# Production Release Gap

Production has applied no migration since 2026-05-10, and `preprod` sits 75 commits
ahead of `main` — so June and July are built but unreleased. The migration workflow
only fires on pushes to `main` touching `prisma/migrations/**`, so fixing it never
re-triggered the run that failed on 17 June. Governance tallies error, the
notification center has no tables, and address-less bot registration cannot work.

Unblocking is one release plus one manual workflow dispatch, and it is the first
task of August.

## Related

[[Migration Deploy Pipeline]] · [[Row-Level Security Hardening]] · [[Email Notification Center]] · [[Bot Registration & Claim Flow]]
