---
type: feature
area: Growth & Accounts
state: in-progress
owner: Andre
milestone: 2026-08
issues: [33]
updated: 2026-08-27
---

# Discover Page

Lookup by signer and by policy, built into the import wizard's "Discover on-chain"
tab rather than a standalone page. Moved up from February to ride the delivered
Wallet V2 discovery work.

Scope as built: search a signer address / key hash, or a multisig wallet address /
native-script hash; results are the CIP-0146 registrations on chain, importable
when the connected wallet is a participant and view-only otherwise. Backed by the
public `resolveScript` route and exposed to agents through the MCP
`multisig_lookup_wallet` tool. Browsing wallets, DAOs and governance activity as a
directory is out of scope (dropped, not deferred). GitHub issue #52 was closed as
unspecified; the work is tracked under #33.

## Related

[[Wallet V2 Registration & Discovery]] · [[User Profiles & Contacts]]
