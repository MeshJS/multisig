# MCP endpoint (`POST /api/mcp`)

A [Model Context Protocol](https://modelcontextprotocol.io) server, so an LLM agent
(Claude Code, claude.ai, or any MCP client) can read multisig wallets, UTxOs, pending
transactions, proxies, governance proposals and sign-off documents, draft ballot
rationales, and draft unsigned transactions for the wallet's signers to review.

Built on `@modelcontextprotocol/server` v2, which implements the 2026-07-28 spec and
also serves 2025-era clients through its legacy path — both from the same tool registry.

## Stateless

One HTTP POST is one complete MCP exchange. There is no session store, no SSE stream
and no resumability, so `GET` and `DELETE` (the 2025-era session verbs) answer `405`.

`createMcpHandler` builds a fresh `McpServer` and a fresh single-use transport from the
factory on **every request**. Nothing may be hoisted to module scope: a reused transport
throws on the *second* request while the first still looks healthy — which is why
`src/__tests__/mcpRoute.test.ts` asserts two sequential POSTs explicitly.

## Tool surface

| Tool | Scope | Wraps |
|---|---|---|
| `multisig_whoami` | `wallets:read` | — (request context) |
| `multisig_list_wallets` | `wallets:read` | `walletIds.ts` |
| `multisig_list_pending_transactions` | `wallets:read` | `pendingTransactions.ts` |
| `multisig_list_free_utxos` | `wallets:read` | `freeUtxos.ts` |
| `multisig_list_proxies` | `wallets:read` | `proxies.ts` |
| `multisig_proxy_drep_info` | `wallets:read` | `proxyDRepInfo.ts` |
| `multisig_lookup_wallet` | `wallets:read` | `lookupMultisigWallet.ts` (plus `resolveScript.ts` when called with `scriptHash` / `address`) |
| `governance_list_active_proposals` | `governance:read` | `governanceActiveProposals.ts` |
| `governance_list_ballots` | `governance:read` | `botBallots.ts` |
| `governance_vote_history` | `governance:read` | `drepInfo.ts` → `governance/drepVotes.ts` |
| `governance_open_proposals` | `governance:read` | `governanceActiveProposals.ts` × vote history |
| `ballot_upsert` | `ballots:write` | `botBallotsUpsert.ts` |
| `ballot_publish_rationale` | `ballots:write` | `ballotRationaleAnchor.ts` |
| `document_list` | `documents:read` | `documents.ts` |
| `document_get` | `documents:read` | `documentDetail.ts` |
| `transaction_preview` | `transactions:write` | `src/lib/tx-review/preview.ts` (uses `freeUtxos.ts` for inputs) |
| `transaction_propose` | `transactions:write` | `src/lib/tx-review/propose.ts` (uses `freeUtxos.ts` for inputs) |
| `multisig_review_pending_transaction` | `wallets:read` | `pendingTransactions.ts` → `src/lib/tx-review/review.ts` |
| `task_list` | `wallets:read` | `task` tRPC router in-process (`src/lib/task-payout/mcp.ts`) |
| `task_upsert` | `tasks:write` | `task` tRPC router in-process (`src/lib/task-payout/mcp.ts`) |
| `task_prepare_payout` | `transactions:write` | `src/lib/task-payout/preview.ts` → `src/lib/tx-review/preview.ts` (`runSpecPreview`) |

**Nothing here can sign, spend or broadcast.** That is a deliberate boundary. Tool results
carry user-authored strings — wallet names, transaction descriptions, ballot rationales —
so anything an attacker can write into a wallet the caller can read is text that reaches
the model. Pairing that with a signing tool turns prompt injection into a funds-movement
path. `src/__tests__/mcpTools.test.ts` pins the exact set of write tools and fails if one
is added quietly.

`tools/list` is filtered by the caller's scopes, so a client never sees a tool that would
come back 403.

## Transaction drafts: preview → confirm

The two `transactions:write` tools let an agent prepare a transaction that humans then
sign in the app. The design is built around the human seeing exactly what gets created:

1. **`transaction_preview`** takes recipients (ADA and native assets in display units),
   staking certificates and DRep votes, builds the unsigned transaction against the
   wallet's spendable UTxOs, and returns three things: a readable summary, a **review
   card PNG** as an `image` content block (recipients with resolved labels, amounts, fee,
   change, actions, and the statement that nothing is signed), and a **draft token**.
   Nothing is stored. The tool is annotated read-only. Staking certificates are checked
   against the account's on-chain registration state (the same Blockfrost probe the
   builder canvas uses): a `DelegateStake` for an unregistered credential gets a
   `RegisterStake` added ahead of it (2 ADA deposit, reported as a warning and shown on
   the card), and the token is minted from that completed spec. A `RegisterStake` for an
   already-registered credential is a 400 — including at propose time, if the account was
   registered after the preview — rather than a transaction the node would reject only
   after the signatures are in. Votes are checked the same way against the DRep's
   on-chain registration (`/governance/dreps/{id}`): a wallet that is not registered as a
   DRep cannot vote, so the draft is a 400 whose message says so and tells the user to
   register in the app first. Both probes are repeated at propose time.
2. The agent shows the card and asks the user to confirm.
3. **`transaction_propose`** accepts *only* the draft token. It rebuilds from the spec
   inside the token, creates the pending transaction with `signedAddresses: []`, notifies
   every signer (the proposer included — they have not signed), and returns the final
   card. Because propose takes no recipients or amounts, a model cannot change the
   transaction between the review and the creation; it would have to preview again,
   which shows a new card.

The draft token is a JWT (`typ: "mcp_draft"`, 15 minutes) signed with `JWT_SECRET`,
bound to the acting address, the OAuth client, the wallet, the normalized spec in base
units and the previewed tx hash (`src/lib/tx-review/draft-token.ts`). It verifies as
neither an access token nor a v1 bearer. Replaying a token returns the transaction the
first call created (the draft id is stored under a top-level `mcp` key in `txJson`), so a
retried confirmation never spends the same UTxOs twice.

Properties worth not regressing:

- Every transaction created through MCP starts with **zero signatures**. The persistence
  helper would broadcast a single-signer transaction only when the initial signer set
  already meets the threshold, which an empty set never does — and propose refuses a
  broadcast result anyway.
- Change always returns to the wallet itself (enforced in `src/lib/tx-draft`).
- Vote rationales are pinned to IPFS **only on propose** — public and permanent, so only
  after the human said yes and only for a draft that still validates. This is why the
  final tx hash can differ from the previewed one; the result says so
  (`txHashChanged`, `txHashChangeReasons`).
- Unknown token decimals are never guessed: a fractional quantity for a token without
  registry metadata is rejected; a whole number is treated as raw units with a warning.
- The scope is human-only. `mcpScopesForBot` never projects a bot key onto
  `transactions:write`; a bot with `multisig:sign` already has `POST /api/v1/addTransaction`.
- Every call is audited (`mcp.tool.called`), and a propose additionally writes a
  `transaction.create` row with `via: "mcp"`.

`multisig_review_pending_transaction` renders the same card for any pending transaction,
however it was created — the in-chat review for transactions proposed from the app.

### Task payouts

The project task board (`/wallets/[wallet]/tasks`) stores payment recipients per task, in
base units. `task_prepare_payout` turns one or more tasks into a draft through the same
pipeline: the recipient rows become a canonical spec (`src/lib/task-payout/spec.ts`,
outputs merged per address), `runSpecPreview` builds and summarizes it, and the draft
token is minted with an extra `origin` claim — the task ids and a sha256 over their
`(taskId, address, unit, quantity)` rows. There is no separate confirm tool:
`transaction_propose` accepts the token, and `withTaskPayoutHooks`
(`src/lib/task-payout/hooks.ts`) does the task-specific work inside the database
transaction that inserts the pending row — re-reads the tasks, refuses with a 409 if any
row changed since the preview (`TASK_CHANGED`) or a payout appeared for one of them
(`TASK_NOT_PAYABLE`), then writes one `TaskPayout` link per task. Row and links exist
together or not at all. The txJson carries a top-level `tasks` namespace next to `mcp`.

The web app's payout dialog is the same two calls (`task.preparePayout`,
`task.confirmPayout` in `src/server/api/routers/tasks.ts`) with the caller derived from
the session and `clientName: "app"`, so a token previewed in the app is not redeemable
through an MCP connection or vice versa. Links flip to `Paid` when the transaction
reaches state 1 and to `Cancelled` when a pending one is deleted or replaced
(`src/lib/task-payout/sync.ts`); the board derives the badge from those rows.

### Getting the card in front of the user

Whether a tool's image block is rendered inline is the client's decision, not the
server's: claude.ai and Claude Desktop show tool images only inside the collapsed
tool-call panel ([claude-ai-mcp #238](https://github.com/anthropics/claude-ai-mcp/issues/238),
[claude-code #53256](https://github.com/anthropics/claude-code/issues/53256)), and the
model decides whether to surface it in its reply. The server therefore tells the model,
three ways, that the image is the deliverable:

- **Server `instructions`** (`MCP_SERVER_INSTRUCTIONS` in `src/lib/mcp/server.ts`),
  returned at initialize and placed in the model's context by the client: the review
  tools' results include the card as an image; present it in the same turn, unprompted;
  ask for confirmation before proposing. Kept short — it rides on every conversation.
- **Tool descriptions** repeat the contract per tool ("the result contains the card as
  an IMAGE: show it to the user in your reply").
- **The result itself**: the text block opens with "Review card attached as an image in
  this result — show it to the user now.", and `structuredContent.reviewCard` says an
  image is attached.

Content blocks deliberately carry **no** spec `annotations` (`audience`, `priority`): the
Claude app rejected a result whose image block had them ("Unexpected response type"),
and `src/__tests__/mcpRoute.test.ts` pins the minimal wire shape.

### The inline card view (MCP App)

Even when the model surfaces the image, the Claude app shows a tool's image block only
inside the collapsed tool-call panel. The protocol's answer is an
[MCP App](https://modelcontextprotocol.io/extensions/apps/build): the three review tools
carry `_meta.ui.resourceUri = "ui://mesh-multisig/review-card"`, and the server exposes
that resource as `text/html;profile=mcp-app`. A supporting host (claude.ai, Claude
Desktop) reads it, renders it inline in a sandboxed iframe where the tool call appears,
and hands it the tool result.

The view (`src/lib/mcp/apps/review-card.ts`) is one self-contained HTML document that
hand-rolls the ext-apps bridge (JSON-RPC over `postMessage`): `ui/initialize` →
`ui/notifications/initialized`, then on `ui/notifications/tool-result` it shows the card
PNG from the image block. For a preview it offers a **Confirm** button: the click sends
`tools/call transaction_propose { draftToken }` through the host — so the human confirms
on the card itself, under the same token binding as a typed confirmation — then shows
the final card, an "Open in the app to sign" link (`ui/open-link`), and tells the model
what happened via `ui/update-model-context`. It declares no network or external-asset
origins and runs under the extension's default CSP; the PNG travels as a `data:` URL.

Things learned from Anthropic's client (tracked in
[claude-ai-mcp #61](https://github.com/anthropics/claude-ai-mcp/issues/61)): the frame
stays hidden until the handshake completes; claude.ai does not advertise the UI extension
at initialize, so the resource is never gated on it; and the host may read the resource
from a different session than the tool call, which this stateless server handles
trivially. Text-only clients (Claude Code included) see the text and image blocks as
before. `src/__tests__/mcpReviewCardApp.test.ts` pins the bridge method names and the
sandbox constraints; `mcpRoute.test.ts` pins `_meta` and `resources/read`.

Expanding the tool call in the client always shows the card, whatever the model did.
Reconnect after changing the instructions — clients read them once, at initialize.

The card is rasterized with the `ImageResponse` that ships inside Next (`next/og`) in
the Node runtime: no new dependency, no system fonts. `next.config.js` adds its WASM and
font files to the `/api/mcp` output file trace, because they are loaded through
`import.meta.url` and tracing cannot see them.

## How tools reach the API

Most tools invoke the existing `/api/v1/*` handlers **in-process** through a synthetic
request/response pair (`src/lib/mcp/invokeV1.ts`) — not a loopback `fetch`, and not
reimplemented logic. Every authorization check, validation branch and error code stays
defined exactly once, in the v1 handler. The transaction review tools are the exception:
no REST route builds an arbitrary transaction for a caller, so they live in
`src/lib/tx-review/` and reuse the canvas builder's `src/lib/tx-draft/` pipeline
server-side, taking their inputs from the `freeUtxos` handler.

Handler imports in `src/lib/mcp/tools.ts` are **lazy on purpose**. Several v1 handlers
import `@meshsdk/core` / `@meshsdk/core-csl` at module top level, which pulls the whisky
WASM into any module graph that references them. A static import would drag that into
this route's cold path for every request, including a bare `tools/list`.

## Scopes

Defined in `src/lib/mcp/scopes.ts` — the MCP spec deliberately defines no vocabulary.

- `wallets:read` — wallets, pending transactions (and their review cards), spendable UTxOs, proxies
- `governance:read` — governance proposals, ballots, DRep vote history
- `ballots:write` — ballot drafts and rationale publication to IPFS (no on-chain vote)
- `documents:read` — sign-off documents (no approval or signature)
- `transactions:write` — unsigned transaction drafts via preview → confirm (no signing, no broadcast); includes task payout drafts
- `tasks:write` — create, edit and move project tasks and their payment recipients (records only; reading the board is `wallets:read`)

**What a client gets by default.** The `WWW-Authenticate` challenge advertises **every**
scope. Clients request exactly the challenge's `scope` — Claude Code uses it rather than
`scopes_supported` from the metadata document — so a scope omitted there is unreachable
in practice, however well documented. Withholding a scope is the user's decision on the
consent screen, where each one is a separate checkbox.

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
asserts both directions; `src/__tests__/txReviewDraftToken.test.ts` adds the draft token
as a third, equally non-interchangeable family.

An unauthenticated request answers `401` with the RFC 9728 challenge:

```
WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource/api/mcp", scope="wallets:read governance:read ballots:write documents:read transactions:write tasks:write"
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
| `src/lib/mcp/server.ts` | Per-request `McpServer` factory, result mapping (text + image blocks), audit |
| `src/lib/mcp/tools.ts` | Tool registry — the source of truth for the surface |
| `src/lib/mcp/schemas.ts` | Hand-written JSON Schemas for tool inputs |
| `src/lib/mcp/invokeV1.ts` | In-process v1 handler invocation |
| `src/lib/mcp/auth.ts` | Caller resolution + internal token minting |
| `src/lib/mcp/scopes.ts` | Scope vocabulary |
| `src/lib/tx-review/spec.ts` | Tool input → canonical spec (base units) → `TxDraft` |
| `src/lib/tx-review/context.ts` | Wallet, script, DRep and staking context, signer authorization |
| `src/lib/tx-review/pipeline.ts` | UTxOs → validate → build → summarize → card, shared by preview and propose |
| `src/lib/tx-review/summary.ts` | The one summary model behind text, JSON and PNG |
| `src/lib/tx-review/card.ts`, `render-png.ts` | Card layout tree and `next/og` rasterization |
| `src/lib/tx-review/draft-token.ts` | The preview → confirm binding |
| `src/lib/tx-review/preview.ts`, `propose.ts`, `review.ts` | The three tool bodies |
| `src/lib/mcp/apps/review-card.ts` | The inline review-card view (MCP App resource + bridge) |
| `src/lib/task-payout/spec.ts`, `load.ts` | Task rows → canonical payout spec; recipients hash |
| `src/lib/task-payout/preview.ts`, `hooks.ts` | `task_prepare_payout` body; the task link hooks `transaction_propose` and the app share |
| `src/lib/task-payout/mcp.ts` | `task_list` / `task_upsert` bodies (the `task` tRPC router in-process) |
| `src/lib/task-payout/deps.ts`, `sync.ts` | Pipeline deps from a tRPC session; Paid/Cancelled link sync |

Tool inputs are hand-written JSON Schema rather than generated from
`src/utils/swagger.ts`: that file is a hand-maintained literal with `apis: []` that has
already drifted from the handlers it documents.

## Tests

```bash
npx jest src/__tests__/mcpTools.test.ts src/__tests__/mcpRoute.test.ts src/__tests__/txReview*.test.ts
npm run test:esm -- src/__tests__/txReviewRenderPng.test.ts
```

`mcpRoute.test.ts` drives the **real** SDK — mocking it would prove nothing about the
transport wiring or the bridge, which are the parts most likely to break. The render test
lives in the ESM project because `next/og` is an ESM bundle the CJS project cannot load.
