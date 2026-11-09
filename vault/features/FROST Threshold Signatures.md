---
type: feature
area: Research
state: delivered
owner: Quirin
milestone: 2026-10
issues: [220]
updated: 2026-10-16
---

# FROST Threshold Signatures

Research delivered: [`docs/research/frost-go-no-go.md`](../../docs/research/frost-go-no-go.md).

FROST(Ed25519, SHA-512) works on Cardano without a ledger change. The group key is
one ordinary key hash, and its signature is one ordinary 101-byte vkey witness. The
PoC in `scripts/research/frost-ed25519/` reproduces the RFC 9591 test vector byte for
byte and verifies 2-of-3 and 3-of-5 signatures under the Mesh CSL. Run it with
`npx jest src/__tests__/frostResearchPoc.test.ts`; all 13 tests pass.

**Verdict: NO-GO on replacing native scripts.** The saving is 206 B (≈0.009 ADA) per
transaction for 2-of-3 and 371 B (≈0.016 ADA) for 3-of-5. Against that, the signer
set and threshold leave the chain, no CIP-30 or hardware wallet can hold a share, and
nonce reuse leaks key shares.

**CONDITIONAL GO on an opt-in FROST signer as one leaf inside a native script.** It
would be built on ZF `frost-ed25519` via WASM with DKG, so a sub-team can share a seat
and reshare without moving the wallet address.

## Related

[[Post-Quantum Multi-Sig]] · [[Multi-Signature Wallet Core]]
