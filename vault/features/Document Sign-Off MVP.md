---
type: feature
area: Document Sign-Off
state: delivered
owner: Quirin & Andre
milestone: 2026-08
prs: [356, 373, 375, 377, 378, 380, 381, 382, 384, 386, 387, 388, 397, 398]
updated: 2026-10-10
---

# Document Sign-Off MVP

The four primitives, shipped: document creation, hash-bound versioning, signer
review against the wallet's inherited threshold, and an exportable audit proof as
JSON and PDF, checkable by anyone at the public `/verify` route without an account.
Approval belongs to a version, never a mutable container — a new version starts a
fresh round at zero approvals. All six PRD-001 user stories run end to end, and the
whole chain is covered against a real database with real CIP-8 keys.

Two things remain before PRD-001's own bar is met: Playwright browser specs for the
sign-off flows, and a pilot team running the six stories without developer help.

## Related

[[Revision Provenance]] · [[Multi-Signature Wallet Core]] · [[Hardware Wallet Support]] · [[Playwright E2E Suite]]
