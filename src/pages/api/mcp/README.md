# MCP endpoint (`POST /api/mcp`)

A [Model Context Protocol](https://modelcontextprotocol.io) server, so an LLM agent
(Claude Code, claude.ai, or any MCP client) can read multisig wallets, UTxOs, pending
transactions, proxies and governance proposals, and draft ballot rationales.

Built on `@modelcontextprotocol/server` v2, which implements the 2026-07-28 spec and
also serves 2025-era clients through its legacy path — both from the same tool registry.

## Stateless

One HTTP POST is one complete MCP exchange. There is no session store, no SSE stream
and no resumability, so `GET` and `DELETE` (the 2025-era session verbs) answer `405`.

`createMcpHandler` builds a fresh `McpServer` and a fresh single-use transport from the
factory on **every request**. Nothing may be hoisted to module scope: a reused transport
throws on the *second* request while the first still looks healthy — which is why
`src/__tests__/mcpRoute.test.ts` asserts two sequential POSTs explicitly.

## Tool surface — read-only plus ballot drafts

| Tool | Scope | Wraps |
|---|---|---|
| `multisig_whoami` | `wallets:read` | — (request context) |
| `multisig_list_wallets` | `wallets:read` | `walletIds.ts` |
| `multisig_list_pending_transactions` | `wallets:read` | `pendingTransactions.ts` |
| `multisig_list_free_utxos` | `wallets:read` | `freeUtxos.ts` |
| `multisig_list_proxies` | `wallets:read` | `proxies.ts` |
| `multisig_proxy_drep_info` | `wallets:read` | `proxyDRepInfo.ts` |
| `multisig_lookup_wallet` | `wallets:read` | `lookupMultisigWallet.ts` |
| `governance_list_active_proposals` | `governance:read` | `governanceActiveProposals.ts` |
| `ballot_upsert` | `ballots:write` | `botBallotsUpsert.ts` |

**Nothing here can sign, spend or broadcast.** That is a deliberate boundary. Tool results
carry user-authored strings — wallet names, transaction descriptions, ballot rationales —
so anything an attacker can write into a wallet the caller can read is text that reaches
the model. Pairing that with a signing tool turns prompt injection into a funds-movement
path, so a write surface needs its own design pass, not a new row in
`src/lib/mcp/tools.ts`. `src/__tests__/mcpTools.test.ts` fails if one is added quietly.

`tools/list` is filtered by the caller's scopes, so a client never sees a tool that would
come back 403.

## How tools reach the API

Tools invoke the existing `/api/v1/*` handlers **in-process** through a synthetic
request/response pair (`src/lib/mcp/invokeV1.ts`) — not a loopback `fetch`, and not
reimplemented logic. Every authorization check, validation branch and error code stays
defined exactly once, in the v1 handler.

Handler imports in `src/lib/mcp/tools.ts` are **lazy on purpose**. Several v1 handlers
import `@meshsdk/core` / `@meshsdk/core-csl` at module top level, which pulls the whisky
WASM into any module graph that references them. A static import would drag that into
this route's cold path for every request, including a bare `tools/list`.

## Scopes

Defined in `src/lib/mcp/scopes.ts` — the MCP spec deliberately defines no vocabulary.

- `wallets:read` — wallets, pending transactions, spendable UTxOs, proxies
- `governance:read` — active governance proposals
- `ballots:write` — ballot drafts, including rationale text (no on-chain vote)

**What a client gets by default.** The `WWW-Authenticate` challenge advertises
`wallets:read governance:read`. That is what clients actually request — Claude
Code uses the challenge's `scope` rather than `scopes_supported` from the
metadata document — so a scope omitted there is unreachable in practice, however
well documented. `ballots:write` is deliberately excluded: it is the only scope
that writes anything, so a client must ask for it explicitly (in Claude Code,
pin `oauth.scopes` for the server). Re-authorize after changing it.

These are intentionally *not* the `BOT_SCOPES` strings from `src/lib/auth/botKey.ts`.
When a bot key authenticates, `mcpScopesForBot` projects one onto the other so a bot never
gains MCP reach it lacks over REST — notably, `multisig:sign` maps to nothing.

## Authentication

`Authorization: Bearer <token>`. Two credential families are accepted:

1. **An OAuth 2.1 access token** from this app's own authorization server — the
   spec-conformant path, and what an MCP client negotiates on its own. See
   [the OAuth README](../oauth/README.md).
2. **An existing v1 bearer token** — a human wallet JWT, or a bot JWT from
   `POST /api/v1/botAuth`. Kept so existing bots and REST tooling can reach the MCP
   surface without a browser consent flow.

The two cannot be confused for one another despite sharing `JWT_SECRET`: OAuth tokens
carry the subject in `sub` (so `verifyJwt` rejects them outright) and are typed
`mcp_at` (so a v1 token fails OAuth verification). `src/__tests__/oauthTokens.test.ts`
asserts both directions.

An unauthenticated request answers `401` with the RFC 9728 challenge:

```
WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource/api/mcp", scope="wallets:read"
```

That header is what lets an MCP client discover the authorization server and begin an
OAuth flow unprompted. Access tokens are audience-bound (RFC 8707): a token minted for a
different resource is rejected even with a valid signature from the same issuer.

A request carrying an `Origin` header is rejected with `403` — MCP clients are server-side
and send none, so a present `Origin` means a browser is driving the endpoint, which is a
DNS-rebinding vector against a locally running server.

## Client configuration

```bash
claude mcp add --transport http mesh-multisig https://multisig.meshjs.dev/api/mcp
```

With an explicit bearer token instead of OAuth:

```bash
claude mcp add --transport http mesh-multisig https://multisig.meshjs.dev/api/mcp --header "Authorization: Bearer <token>"
```

## Layout

| File | Role |
|---|---|
| `src/pages/api/mcp/index.ts` | The route: guards, auth, bridge, handler |
| `src/lib/mcp/bridge.ts` | Node `req`/`res` ↔ web `Request`/`Response` |
| `src/lib/mcp/server.ts` | Per-request `McpServer` factory, result mapping |
| `src/lib/mcp/tools.ts` | Tool registry — the source of truth for the surface |
| `src/lib/mcp/schemas.ts` | Hand-written JSON Schemas for tool inputs |
| `src/lib/mcp/invokeV1.ts` | In-process v1 handler invocation |
| `src/lib/mcp/auth.ts` | Caller resolution + internal token minting |
| `src/lib/mcp/scopes.ts` | Scope vocabulary |

Tool inputs are hand-written JSON Schema rather than generated from
`src/utils/swagger.ts`: that file is a hand-maintained literal with `apis: []` that has
already drifted from the handlers it documents.

## Tests

```bash
npx jest src/__tests__/mcpTools.test.ts src/__tests__/mcpRoute.test.ts
```

`mcpRoute.test.ts` drives the **real** SDK — mocking it would prove nothing about the
transport wiring or the bridge, which are the parts most likely to break.
