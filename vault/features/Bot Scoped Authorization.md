---
type: feature
area: Bot & Agent Platform
state: delivered
owner: Quirin
milestone: 2026-07
updated: 2026-07-27
---

# Bot Scoped Authorization

Double opt-in: a scope on the key **and** a per-wallet grant. Five scopes cover
wallet creation, reads, signing, governance reads and ballot writes; each wallet
separately grants a bot either cosigner or observer access. 27 endpoints accept bot
tokens, including signing with auto-submit once the threshold is met — but the
wallet's M-of-N threshold still gates submission, so a bot can never move funds
alone.

## Related

[[Bot Registration & Claim Flow]] · [[Multi-Signature Wallet Core]] · [[Improved Authentication]]
