---
type: feature
area: Wallets & Discovery
state: delivered
owner: Quirin
milestone: 2026-05
issues: [223]
prs: [210, 225]
updated: 2026-07-27
---

# Legacy Wallet Compatibility

Keeping wallets created by earlier versions working, including DRep retirement and
deregistration. Legacy wallets carry raw imported bodies, so their bytes must be
preserved exactly or co-signers end up signing different transactions.

## Related

[[Multi-Signature Wallet Core]] · [[Signing & Auth Reliability]] · [[Wallet Import]]
