---
name: multisig
description: Build and integrate with the Mesh Multisig (Cardano multisig wallet) codebase. Use when working on multisig wallets, bot API, v1 REST endpoints, wallet flows, governance, or Cardano treasury tooling.
---

# Multisig (Mesh)

## Project overview

- **Stack**: Next.js (Pages Router), tRPC, Prisma, Cardano (Mesh SDK).
- **Auth**: NextAuth (user) + JWT for API (wallet sign-in or bot keys).
- **API**: REST v1 under `/api/v1/*` (Swagger at `/api-docs`, spec at `/api/swagger`).

## Key areas

| Area | Location | Notes |
|------|----------|--------|
| Landing page | `src/components/pages/homepage/index.tsx` | Hero, features, DApps, Developers & Bots section |
| API docs (Swagger) | `src/pages/api-docs.tsx`, `src/utils/swagger.ts` | OpenAPI 3.0; add new paths in `swagger.ts` |
| Bot API | `src/pages/api/v1/botAuth.ts`, `src/lib/auth/botKey.ts`, `src/lib/auth/botAccess.ts` | Bot auth: POST `/api/v1/botAuth` with `botKeyId`, `secret`, `paymentAddress` |
| Reference bot client | `scripts/bot-ref/` | `bot-client.ts`; auth → walletIds, pendingTransactions, freeUtxos |
| Wallet flows | `src/components/pages/homepage/wallets/new-wallet-flow/`, `useWalletFlowState.tsx` | New wallet creation and invite flow |
| tRPC | `src/server/api/routers/`, `src/server/api/root.ts` | Wallets, bot routers |
| DB | `prisma/schema.prisma` | Wallet, BotKey, BotUser, etc. |

## Bot integration (machine-friendly)

- **OpenAPI spec (JSON)**: `GET /api/swagger` — use for codegen or automation.
- **Registration (new bots)**: `POST /api/v1/botRegister`  
  Body: `{ "name": string, "requestedScopes": string[], "paymentAddress"?: string }`  
  New bots should initially register **without** `paymentAddress` — a fresh bot has no wallet yet. Register with just name + scopes, have the owner claim you, pick up your credentials, generate a wallet, then bind the address at first `botAuth`. Only pass `paymentAddress` at registration if the bot already controls a wallet.
- **Auth (bots)**: `POST /api/v1/botAuth`  
  Body: `{ "botKeyId": string, "secret": string, "paymentAddress"?: string, "stakeAddress"?: string }`  
  Response: `{ "token": string, "botId": string }`. Use `Authorization: Bearer <token>` for v1 endpoints. The first successful `botAuth` binds `paymentAddress` to the bot (required then; creates its `BotUser` if registration was address-less). Afterwards `paymentAddress` is optional — the JWT always carries the server-side bound address, and a mismatching supplied address is rejected (409). The token lives ~1 hour: cache it and re-auth on 401; the `secret` is picked up once via `botPickupSecret` but stays valid for repeated auths — store it safely.
- **Ballot drafting lifecycle (bots)**: `POST /api/v1/botBallotsUpsert` (drafts; proposalIds validated against the chain; response has `created` + `ballot.id`), `GET /api/v1/botBallots?walletId=` (reconcile your drafts), `DELETE /api/v1/botBallots` with `{walletId, ballotId}` (clean up stale drafts). All need `ballot:write` scope + any wallet grant (observer is enough). `GET /api/v1/botMe` returns `botWallets` (grants + roles) for self-discovery; `POST /api/v1/botRotateSecret` with the current secret mints a replacement if it leaks.
- **Rate-limit etiquette (bots)**: requests are limited per IP and per bot (default 40/min). Don't fan out in parallel — space calls ~200–500 ms apart. Responses carry `X-RateLimit-Remaining`/`X-RateLimit-Reset`; a 429 carries `Retry-After` (seconds) — wait that long (the reference client's `fetchWithBackoff` in `scripts/bot-ref/bot-client.ts` does this). Rejected requests never extend the window.
- **Governance reads (bots)**: `GET /api/v1/governanceActiveProposals?details=true` — use `details=true` to get `expiration` (voting-deadline epoch) and `deposit`; the response's `currentEpoch` gives time-to-deadline. "Active" = no terminal epoch on-chain; explorers may show a higher "active" count because they still display ratified-but-not-enacted actions — pass `includeRatified=true` to include those (status `ratified`, outcome already decided).
- **Bot keys**: Created in-app (User → Create bot). One bot key can have one `paymentAddress`; same address cannot be used by another bot.
- **Scopes**: Bot keys have scope (e.g. `multisig:read`); `botAccess.ts` enforces wallet access for bots.
- **V1 endpoints used by bots**: `walletIds` (query `address` = bot’s `paymentAddress`), `pendingTransactions`, `freeUtxos`, `addTransaction`, `signTransaction`, etc. Same as wallet-authenticated calls but identity is the bot’s registered address.

## Conventions

- **Wallet ID**: UUID from DB; **address**: Cardano payment (or stake) address.
- **Scripts**: Reference scripts in `scripts/` (e.g. `scripts/bot-ref/`). Use `npx tsx` for TS scripts.
- **Env**: `JWT_SECRET` required for API tokens; bot keys stored hashed in DB.

## When editing

- Adding a new v1 endpoint: implement in `src/pages/api/v1/<name>.ts`, add path and CORS/rate limits, then add to `src/utils/swagger.ts` and document bot usage if applicable.
- Changing bot auth or scopes: update `botAuth.ts`, `botAccess.ts`, and landing “Developers & Bots” section plus `scripts/bot-ref/README.md` if needed.
- Landing page: human and bot-friendly docs live in the “Developers & Bots” section; keep OpenAPI URL and bot auth summary accurate.
