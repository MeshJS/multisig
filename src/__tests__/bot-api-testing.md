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

## PR Workflow: Containers + CI Wallet Smoke

- Workflow: `.github/workflows/pr-multisig-v1-smoke.yml`
- Triggers: `pull_request` and `workflow_dispatch` (manual test runs)
- Compose stack: `docker-compose.ci.yml`
- CI scripts:
  - `scripts/ci/cli/bootstrap.ts`
  - `scripts/ci/cli/route-chain.ts` (route-chain runner; filter with `CI_ROUTE_SCENARIOS`)
  - `scripts/ci/cli/sign-transaction.ts` (ad-hoc sign helper)
  - `scripts/ci/scenarios/manifest.ts` (scenario registry)

### Required GitHub repository secrets

- `CI_JWT_SECRET` (32+ chars)
- `CI_MNEMONIC_1` (space-separated words)
- `CI_MNEMONIC_2` (space-separated words)
- `CI_MNEMONIC_3` (space-separated words)
- `CI_BLOCKFROST_PREPROD_API_KEY` (required; transfer and signing scenarios use live preprod data)
- `CI_BLOCKFROST_MAINNET_API_KEY` (optional; only needed if smoke coverage is expanded to mainnet-dependent routes)

### Runtime flags used by the workflow

- `CI_NETWORK_ID` (default `0` for preprod/testnet)
- `CI_NUM_REQUIRED_SIGNERS` (default `2`; controls `numRequiredSigners` and hierarchical inner `atLeast.required`)
- `CI_WALLET_TYPES` (default `legacy,hierarchical,sdk`)
- `CI_SIGN_WALLET_TYPE` (which wallet type signing smoke targets: `legacy` | `hierarchical` | `sdk`)
- `SIGN_BROADCAST` (`true`; broadcast is always enabled for CI route-chain signing)
- `CI_TRANSFER_LOVELACE` (optional transfer amount for real-transfer scenario, default `2000000`)
- `CI_ROUTE_SCENARIOS` (optional comma-separated scenario ids for targeted route-chain runs)

Validation behavior:

- Invalid values in `CI_WALLET_TYPES` now fail fast (must be `legacy`, `hierarchical`, `sdk`).
- Unknown scenario ids in `CI_ROUTE_SCENARIOS` now fail fast with available ids listed.

### What phase 1 validates

- Starts Postgres + app containers on PR.
- Derives signer addresses from the three mnemonic secrets.
- Creates selected wallet types (`legacy`, `hierarchical`, `sdk`) through `/api/v1/createWallet`.
- Uses a nested payment script for `hierarchical` wallets (`all` wrapping `atLeast`) while keeping signer keys payment-only.
- Verifies route-chain health for bot routes (`walletIds`, `pendingTransactions`, `freeUtxos`, `signTransaction`) using shared bootstrap context.
- Executes a real transfer flow:
  - build transfer tx via `/api/v1/addTransaction`
  - sign and broadcast via `/api/v1/signTransaction`
  - assert final state via `/api/v1/pendingTransactions`
- Uploads machine-readable route-chain report artifact from `ci-artifacts/ci-route-chain-report.json`.

### Built-in route-chain scenarios

- `scenario.pending-and-discovery`
- `scenario.pending-per-wallet`
- `scenario.ada-route-health`
- `scenario.real-transfer-and-sign`
- `scenario.final-assertions`

### Add a new v1 route test step

1. Add a new step module or helper in `scripts/ci/scenarios/`.
   - You can start from `scripts/ci/scenarios/steps/template-route-step.ts`.
2. Implement the standard step contract:
   - `id`
   - `description`
   - `execute(ctx)` with deterministic assertions
   - optional `artifacts` for failure triage
3. Register the step in `scripts/ci/scenarios/manifest.ts`.
4. Run the route-chain smoke locally/CI and verify step-level report output.

This keeps wallet bootstrap stable while route coverage grows through small, isolated step additions.
