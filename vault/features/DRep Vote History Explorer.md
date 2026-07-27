---
type: feature
area: Governance
state: delivered
owner: Quirin
milestone: 2026-07
prs: [337, 338, 339]
updated: 2026-07-27
---

# DRep Vote History Explorer

A public explorer at `/governance/drep` — no connected wallet required — showing
every governance action a DRep voted on, with search, a vote filter, CIP-100 and
CIP-136 rationales resolved lazily from IPFS, and a nine-column CSV export that
resolves all rationales before writing. Served through a Koios proxy because
Blockfrost omits the proposal and rationale anchor.

## Related

[[In-App Governance Voting]] · [[Ballot Rationale & IPFS]] · [[Landing, SEO & Theme]]
