---
type: feature
area: Release & Production Health
state: blocked
owner: Quirin
milestone: 2026-08
prs: [332]
updated: 2026-07-27
---

# Row-Level Security Hardening

Seven production tables — including the bot key and claim-token tables and the audit
log — still have row-level security disabled and are reachable by the anon PostgREST
role. The migration that enables RLS with deny-all policies is written and merged;
it is purely undeployed, so this unblocks the moment the release lands.

## Related

[[Production Release Gap]] · [[Migration Deploy Pipeline]] · [[Bot Registration & Claim Flow]]
