---
type: feature
area: Reliability & CI
state: blocked
owner: Andre
milestone: 2026-08
updated: 2026-07-27
---

# Dependabot CI Unblock

The v1 smoke workflow hard-fails when its secrets are absent, and dependabot-triggered
runs never receive repository secrets — so every open dependency PR is red for
systemic reasons rather than because of the bump. Seven are open, the oldest since
2026-06-15. The sibling preprod smoke workflow already has the skip-when-unconfigured
guard to copy.

## Related

[[Real-Chain Smoke Tests]] · [[Playwright E2E Suite]]
