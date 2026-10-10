---
type: feature
area: Platform & UX
state: blocked
owner: Quirin
milestone: 2026-07
prs: [268, 269, 278]
updated: 2026-07-27
---

# Mesh 2.0 Migration

Groundwork is done — Prisma 7.8 and Next 16, a hardfork-ready transaction builder,
and every wallet operation funnelled through a single bridge with an ESLint
guardrail. The cutover itself is blocked upstream: npm's latest `@meshsdk/core` is
still 1.9.1 and no 2.x has been published. Demoted from a monthly task to a standing
watch item, since it cannot be scheduled against an unpublished dependency.

## Related

[[Signing & Auth Reliability]] · [[Multi-Signature Wallet Core]]
