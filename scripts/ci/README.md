# CI Route-Chain Test Suite

This folder contains the real-chain CI smoke system used by `.github/workflows/pr-multisig-v1-smoke.yml`.

## Why this exists

- Protects v1 API routes from regressions on pull requests.
- Verifies behavior against real blockchain conditions (preprod), not only mocked/unit paths.
- Keeps wallet bootstrap stable while allowing route tests to grow incrementally.
- Makes it easy to add new API route checks as composable scenario steps.

## High-level flow

CI runs these stages in order:

1. **Bootstrap** (`create-wallets.ts`)
   - Derives signer addresses from mnemonic secrets.
   - Provisions one bot key per signer address.
   - Creates test wallets (`legacy`, `hierarchical`, `sdk`).
   - Grants all signer bots cosigner access to created wallets.
   - Seeds baseline pending transactions.
   - Writes a versioned context JSON consumed by all later steps.

2. **Route chain** (`run-route-chain.ts`)
   - Loads and validates bootstrap context.
   - Loads enabled scenarios from `scenarios/manifest.ts`.
   - Executes steps in deterministic order with critical/non-critical failure semantics.
   - Emits console summary and machine-readable JSON report.

3. **Artifacts**
   - Route-chain JSON report is written to `ci-artifacts/ci-route-chain-report.json`.
   - Workflow uploads it as an artifact for triage.

## Folder structure

- `create-wallets.ts`
  - Stable setup stage, writes CI context.
- `run-route-chain.ts`
  - Main orchestrator for scenario execution.
- `run-pending-transactions-smoke.ts`
  - Compatibility wrapper for pending-only checks.
- `sign-transaction-preprod.ts`
  - Compatibility wrapper for signing path.
- `framework/`
  - `types.ts`: shared types for context/scenarios/reports.
  - `context.ts`: context loading + validation.
  - `http.ts`: API caller helper with timeout/retry support.
  - `runner.ts`: scenario/step execution + report writing.
- `scenarios/`
  - `manifest.ts`: scenario registry and ordering.
  - `signingFlow.ts`: reusable sign/broadcast flow helper.
  - `transferFlow.ts`: real ADA transfer transaction helper.
  - `template-route-step.ts`: scaffold for new route steps.

## Current scenario intent

The manifest currently covers:

- route discovery (`walletIds`)
- pending checks (per-wallet pending scenario)
- per-wallet pending validations
- route health and signing checks
- real transfer + sign path
- final state assertions after transfer/sign progression

Signing is expected to be on, and broadcast is expected to be on, for normal CI route-chain runs.

Current signing chain in the route manifest runs two signer rounds for selected wallets:

- signer index 1 (`CI_MNEMONIC_2`) signs with broadcast disabled
- signer index 2 (`CI_MNEMONIC_3`) signs with broadcast enabled

## Environment and secrets

Primary variables (in workflow/compose):

- `CI_JWT_SECRET`
- `CI_MNEMONIC_1`, `CI_MNEMONIC_2`, `CI_MNEMONIC_3`
- `CI_BLOCKFROST_PREPROD_API_KEY`
- `CI_BLOCKFROST_MAINNET_API_KEY` (optional; only needed if mainnet provider calls are exercised)
- `CI_NETWORK_ID`
- `CI_WALLET_TYPES`
- `CI_SIGN_WALLET_TYPE`
- `SIGN_BROADCAST`
- `CI_ROUTE_SCENARIOS` (optional scenario id filter)
- `CI_TRANSFER_LOVELACE` (optional transfer amount)

Validation notes:

- `CI_WALLET_TYPES` must contain only `legacy`, `hierarchical`, `sdk`; invalid values fail fast.
- `CI_ROUTE_SCENARIOS` values must exist in `scenarios/manifest.ts`; unknown ids fail fast.
- `CI_MNEMONIC_2` and `CI_MNEMONIC_3` must derive signer addresses from bootstrap context for multi-signer route-chain signing.

## Bootstrap context schema

`create-wallets.ts` writes schema version `2`, with no persisted runtime secrets:

- `bots[]`: `{ id, paymentAddress, botKeyId, botId }`
- `defaultBotId`: primary bot used for discovery/pending/freeUtxos assertions

Security guarantees:

- The context file does not store bot JWT tokens.
- The context file does not store bot secrets.
- Route steps authenticate bots on demand at runtime.
- `docker-compose.ci.yml` removes the context file after route-chain execution.
- Failure log upload applies token/secret redaction filters.

Limitation:

- If application code logs sensitive values directly, redaction can miss uncommon formats.
- Treat uploaded logs as diagnostic artifacts, not as guaranteed zero-leak outputs.

## How to contribute

### Add a new route step

1. Copy `scenarios/template-route-step.ts` into a new step module.
2. Set a stable `id` and route-specific `description`.
3. Implement deterministic inputs from context/env.
4. Call route(s) via `requestJson`.
5. Add strict assertions and concise artifacts for failure triage.
6. Register the step in `scenarios/manifest.ts`.

### Add a new scenario

1. Build a scenario factory in `scenarios/manifest.ts`.
2. Keep ordering intentional (upstream dependencies first).
3. Mark step severity correctly:
   - `critical`: stop scenario/chain on failure.
   - `non-critical`: continue and report.
4. Ensure artifacts are small but diagnostic.

### Keep things maintainable

- Do not overload bootstrap with route-specific behavior.
- Prefer reusable helpers in `framework/` or `scenarios/*Flow.ts`.
- Keep step ids stable (helps CI history and triage).
- Avoid hidden randomness in assertions; use deterministic checks.

## Local execution

From repo root, inside CI-like environment:

- `npx --yes tsx scripts/ci/create-wallets.ts`
- `npx --yes tsx scripts/ci/inspect-context.ts`
- `npx --yes tsx scripts/ci/run-route-chain.ts`

Or run full containerized path via:

- `docker compose -f docker-compose.ci.yml --profile ci-test run --rm ci-runner`

