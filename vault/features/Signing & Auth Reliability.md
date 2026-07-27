---
type: feature
area: Platform & UX
state: delivered
owner: Quirin
milestone: 2026-06
prs: [273, 277, 281, 282, 286, 324, 325]
updated: 2026-07-27
---

# Signing & Auth Reliability

The correctness work under signing: bech32 normalization, the Mesh 1.9 `signData`
argument order, a byte-preserving core-cst witness and body-hash merge with a
regression test, recovery from a stuck "Loading…" state, and login no longer
hanging on "Authorize". Byte preservation is the load-bearing part — co-signers must
sign identical bytes.

## Related

[[Multi-Signature Wallet Core]] · [[Mesh 2.0 Migration]] · [[Legacy Wallet Compatibility]]
