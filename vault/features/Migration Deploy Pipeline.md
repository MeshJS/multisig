---
type: feature
area: Release & Production Health
state: planned
owner: Quirin
milestone: 2026-09
prs: [319]
updated: 2026-07-27
---

# Migration Deploy Pipeline

Make the release path self-verifying instead of dependent on a path filter: run
`prisma migrate status` as a post-deploy gate and alert on drift, so "merged" and
"applied" cannot silently diverge again.

## Related

[[Production Release Gap]] · [[Row-Level Security Hardening]] · [[Real-Chain Smoke Tests]]
