---
type: feature
area: Research
state: delivered
owner: Quirin
milestone: 2026-10
issues: [220]
updated: 2026-10-16
---

# Post-Quantum Multi-Sig

Assessment delivered in [`docs/research/frost-go-no-go.md`](../../docs/research/frost-go-no-go.md) §6.

No scheme called "Lemour" exists. The roadmap item refers to **Lemur** (Monash, ePrint
2026/1161, NIST threshold call): a stateful lattice *synchronized aggregate
multi-signature*, not t-of-n, with no public implementation. Lattice threshold schemes
such as Ringtail sign at about 13 KB, and NIST MPTS packages are due around March 2027.

**Verdict: NO-GO, ledger-gated.** Neither native scripts nor Plutus builtins verify any
post-quantum signature today, so an application cannot build PQ multisig. Re-assess
when NIST MPTS packages land and a CIP adds a PQ verification primitive.

## Related

[[FROST Threshold Signatures]]
