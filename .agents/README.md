# Agent instructions (Mesh Multisig)

Project-specific context for AI coding agents. See also [.cursor/skills/multisig/SKILL.md](../.cursor/skills/multisig/SKILL.md) for the multisig Cursor skill.

## Stack and layout

- **Stack**: Next.js (Pages Router), TypeScript, tRPC, Prisma, PostgreSQL, Cardano (Mesh SDK). Auth: NextAuth (user) + JWT (API: wallet sign-in or bot keys).
- **API**: REST v1 under `/api/v1/*`. OpenAPI: `GET /api/swagger`. Interactive docs: `/api-docs`.
- **Key paths**: Pages in `src/pages/`, UI in `src/components/`, tRPC in `src/server/api/routers/`, REST handlers in `src/pages/api/v1/*.ts`, DB schema in `prisma/schema.prisma`.

## Build and test

- **Install**: `npm install`
- **Env**: Copy `.env.example` to `.env`; set `DATABASE_URL`, `JWT_SECRET`, Blockfrost keys, etc. For local DB: `docker compose -f docker-compose.dev.yml up -d postgres`
- **DB**: `npm run db:update` (format + push schema + generate client). Prisma Studio: `npm run db:studio`
- **Dev**: `npm run dev` → http://localhost:3000
- **Lint**: `npm run lint`
- **Tests**: `npm test` or `npm run test:ci` for CI

## Conventions

- **Wallet ID**: UUID from DB. **Address**: Cardano payment (or stake) address. Don’t confuse them.
- **Scripts**: Use `scripts/` (e.g. `scripts/bot-ref/`). Run TS with `npx tsx`.
- **New v1 endpoint**: Add handler in `src/pages/api/v1/<name>.ts`, apply CORS and rate limits, then add path and docs in `src/utils/swagger.ts`. If bots can call it, update the landing “Developers & Bots” section and `scripts/bot-ref/README.md` as needed.
- **Bot auth**: Implemented in `src/pages/api/v1/botAuth.ts` and `src/lib/auth/botKey.ts`, `botAccess.ts`. Bot keys created in-app (User → Create bot). One key → one `paymentAddress`; use `Authorization: Bearer <token>` for v1 after `POST /api/v1/botAuth`.

## Bot integration (machine-friendly)

- **OpenAPI**: `GET /api/swagger` (JSON).
- **Bot auth**: `POST /api/v1/botAuth` with body `{ "botKeyId", "secret", "paymentAddress" }` → `{ "token", "botId" }`. Use token as Bearer for `walletIds`, `pendingTransactions`, `freeUtxos`, `addTransaction`, `signTransaction`, etc. Reference client: `scripts/bot-ref/` (see README there).

## Docs to keep in sync

- Landing “Developers & Bots” section: `src/components/pages/homepage/index.tsx` (id `#developers-and-bots`).
- API/bot docs: `src/utils/swagger.ts`, `scripts/bot-ref/README.md`.
