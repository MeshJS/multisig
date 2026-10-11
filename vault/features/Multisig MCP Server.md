---
type: feature
area: Bot & Agent Platform
state: delivered
owner: Quirin
milestone: 2026-08
prs: [357, 358, 360, 361, 365, 367, 370, 376]
updated: 2026-10-10
---

# Multisig MCP Server

A stateless MCP endpoint behind an OAuth 2.1 authorization server, so any AI agent
can act as a wallet observer or ballot drafter directly. Clients register
dynamically and authorize with PKCE; the user grants scopes one by one, sees and
revokes connections, and reviews per-wallet activity. Fifteen published tools cover
wallets, governance, ballots and documents. Read-only by design: nothing signs or
broadcasts. Pulled forward from November to August.

## Related

[[Agent & Crawler Legibility]] · [[API Documentation Portal]] · [[Bot Scoped Authorization]]
