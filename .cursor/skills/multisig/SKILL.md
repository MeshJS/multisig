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
- **Auth (bots)**: `POST /api/v1/botAuth`  
  Body: `{ "botKeyId": string, "secret": string, "paymentAddress": string, "stakeAddress"?: string }`  
  Response: `{ "token": string, "botId": string }`. Use `Authorization: Bearer <token>` for v1 endpoints.
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
