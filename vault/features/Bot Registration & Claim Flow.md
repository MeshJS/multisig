---
type: feature
area: Bot & Agent Platform
state: delivered
owner: Quirin
milestone: 2026-07
prs: [341]
updated: 2026-07-27
---

# Bot Registration & Claim Flow

Human-in-the-loop onboarding: a bot self-registers with the scopes it wants and
receives a claim code valid for 30 minutes; its human owner approves that code with
their own session; the secret is then retrievable exactly once. Secrets are stored
as HMAC-SHA256 peppered with the app's JWT secret, and a bot is bound to one payment
address at first authentication. Bots can also register without an address.

## Related

[[Bot Scoped Authorization]] · [[Bot Management UI]] · [[Bot Rate Limiting]]
