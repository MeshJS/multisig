---
type: feature
area: Bot & Agent Platform
state: delivered
owner: Quirin
milestone: 2026-07
updated: 2026-07-27
---

# Bot Rate Limiting

Three tiers of request guard plus body-size caps: 60/min by default, 15/min on
register, pickup and auth, 5/min on secret rotation, and 40/min per bot id.

## Related

[[Bot Registration & Claim Flow]] · [[Bot Scoped Authorization]]
