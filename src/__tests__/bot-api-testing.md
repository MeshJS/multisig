# Bot API Testing Guide

## Bot-Runnable Route Matrix

| Route | Unit Test File | Happy Path | Auth/Access Failure |
| --- | --- | --- | --- |
| `/api/v1/botAuth` | `src/__tests__/botAuth.test.ts` | token + bot id returned | invalid secret rejected |
| `/api/v1/botMe` | `src/__tests__/botMe.test.ts` | profile payload returned | non-bot token rejected |
| `/api/v1/createWallet` | `src/__tests__/createWallet.bot.test.ts` | wallet created + bot access upserted | invalid signer address rejected |
| `/api/v1/walletIds` | `src/__tests__/walletIds.bot.test.ts` | wallet ids returned | address mismatch rejected |
| `/api/v1/pendingTransactions` | `src/__tests__/pendingTransactions.bot.test.ts` | pending tx list returned | wallet access denied |
| `/api/v1/freeUtxos` | `src/__tests__/freeUtxos.bot.test.ts` | free UTxOs returned | wallet access denied |
| `/api/v1/addTransaction` | `src/__tests__/addTransaction.bot.test.ts` | tx record created | bot wallet access denied |
| `/api/v1/nativeScript` | `src/__tests__/nativeScript.bot.test.ts` | script response returned | address mismatch rejected |
| `/api/v1/governanceActiveProposals` | `src/__tests__/governanceActiveProposals.test.ts` | active proposals returned | missing/invalid token rejected |
| `/api/v1/botBallotsUpsert` | `src/__tests__/botBallotsUpsert.test.ts` | ballot upsert paths covered | input and conflict errors covered |
| `/api/v1/signTransaction` | `src/__tests__/signTransaction.bot.test.ts` | witness recorded for bot cosigner | non-cosigner role rejected |
| `/api/v1/submitDatum` | `src/__tests__/submitDatum.bot.test.ts` | signable datum created | invalid signature rejected |

## New Bot Route Test Checklist

- Add a `*.bot.test.ts` file in `src/__tests__/` with the route name.
- Use `createMockResponse()` and bot payload defaults from `src/__tests__/apiTestUtils.ts`.
- Cover at least:
  - one success response with expected JSON shape,
  - one auth/scope/access failure branch,
  - one method/validation branch when route-specific risk is high.
- Keep network and chain helpers mocked; keep route logic and DB interactions under test.

## Integration Smoke Tests

- File: `src/__tests__/botApi.integration.test.ts`
- Default behavior: skipped unless `RUN_BOT_API_INTEGRATION=true`
- Purpose: exercise real Prisma DB writes/reads for bot auth, wallet access reads, mutating routes, and one signature-heavy route with mocked signature validator.

### Required env for integration run

- `RUN_BOT_API_INTEGRATION=true`
- `DATABASE_URL=<test Postgres url>`
- `JWT_SECRET=<32+ char secret>`
- `SKIP_ENV_VALIDATION=true` (recommended for test-only runs)
