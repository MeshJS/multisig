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
- route health checks (`freeUtxos`, `nativeScript`)
- real multisig-wallet ring transfer + sign path
- pending lifecycle assertions for ring transfer txs only
- final state assertions after transfer/sign progression

For each tested wallet type, the `nativeScript` step stores decoded script payloads in step artifacts (`artifacts.nativeScripts`) inside `ci-route-chain-report.json`, so script structure is visible during CI triage.

Signing is expected to be on, and broadcast is expected to be on, for normal CI route-chain runs.

Current transfer/sign chain in the route manifest runs a deterministic ring across multisig wallet addresses:

- `legacy.walletAddress -> hierarchical.walletAddress`
- `hierarchical.walletAddress -> sdk.walletAddress`
- `sdk.walletAddress -> legacy.walletAddress`

Each ring leg uses the same `CI_TRANSFER_LOVELACE` amount, so balances remain close after one cycle (differences are fee-driven).

Real transfer construction is script-native:

- route-chain spends UTxOs from the source multisig wallet script address
- destination is the next multisig wallet script address in the ring
- change returns to the source multisig wallet script address
- signer mnemonics are used for witness collection/signing, not as transfer funding inputs

For each ring leg, signing runs two signer rounds:

- signer index 1 (`CI_MNEMONIC_2`) signs with broadcast disabled
- signer index 2 (`CI_MNEMONIC_3`) signs with broadcast enabled

Each leg is asserted as pending immediately after `addTransaction`, then asserted removed after signer 2 broadcast.

## Environment and secrets

Primary variables (in workflow/compose):

- `CI_JWT_SECRET`
- `CI_MNEMONIC_1`, `CI_MNEMONIC_2`, `CI_MNEMONIC_3`
- `CI_BLOCKFROST_PREPROD_API_KEY`
- `CI_NETWORK_ID`
- `CI_WALLET_TYPES`
- `CI_SIGN_WALLET_TYPE`
- `SIGN_BROADCAST`
- `CI_ROUTE_SCENARIOS` (optional scenario id filter)
- `CI_TRANSFER_LOVELACE` (optional transfer amount)

Validation notes:

- Route-chain transfer scenarios are preprod-only; `CI_NETWORK_ID` must be `0`.
- Signer/bot/wallet addresses used in context must all be testnet-form (`addr_test` / `stake_test`).
- `CI_WALLET_TYPES` must contain only `legacy`, `hierarchical`, `sdk`; invalid values fail fast.
- The default full route-chain (including ring transfer scenario) requires all three wallet types (`legacy`, `hierarchical`, `sdk`) to be present.
- `CI_ROUTE_SCENARIOS` values must exist in `scenarios/manifest.ts`; unknown ids fail fast.
- `CI_MNEMONIC_2` and `CI_MNEMONIC_3` must derive signer addresses from bootstrap context for multi-signer route-chain signing.
- Source multisig wallet script addresses must be funded on preprod for each ring leg (`legacy -> hierarchical -> sdk -> legacy`).
- `CI_JWT_SECRET` must remain the same between bootstrap and route-chain, because bot auth secrets are deterministically derived from it.

## Bootstrap context schema

`create-wallets.ts` writes schema version `2`, with no persisted runtime secrets:

- `wallets[]`: `{ type, walletId, walletAddress, signerAddresses }` (no seeded `transactionId`)
- `bots[]`: `{ id, paymentAddress, botKeyId, botId }`
- `defaultBotId`: primary bot used for discovery/freeUtxos assertions

Security guarantees:

- The context file does not store bot JWT tokens.
- The context file does not store bot secrets.
- Route steps authenticate bots on demand at runtime.
- `docker-compose.ci.yml` removes the context file after route-chain execution.
- Failure log upload applies token/secret/mnemonic/private-key redaction filters.

Limitation:

- If application code logs sensitive values directly, redaction can miss uncommon formats.
- Treat uploaded logs as diagnostic artifacts, not as guaranteed zero-leak outputs.

Logging policy (required for contributors):

- It is acceptable to log non-sensitive diagnostics: wallet IDs, transaction hashes, key hashes, and testnet addresses.
- Never log raw secrets: mnemonics, private keys/signing keys, bot auth secrets, bearer tokens, or API keys.
- Redaction is best-effort safety net; route steps and helpers must avoid printing sensitive raw values in the first place.

Safe-to-print checklist for new route/scenario code:

- Safe: `walletId`, `transactionId`/tx hash, `paymentAddress`/`stakeAddress` (testnet), `keyHash`, scenario ids/status.
- Forbidden: any `CI_MNEMONIC_*` value, any `xprv*`/`ed25519*_sk*` material, `Authorization` headers, `secret`/`token` payload fields.

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

## Local execution (PowerShell, CI-like)

From repo root:

- `C:\Users\andru\Documents\GitHub\multisig`

Set required CI variables in your current shell:

```powershell
$env:CI_JWT_SECRET="..."
$env:CI_MNEMONIC_1="..."
$env:CI_MNEMONIC_2="..."
$env:CI_MNEMONIC_3="..."
$env:CI_BLOCKFROST_PREPROD_API_KEY="..."
$env:CI_NETWORK_ID="0"
$env:CI_WALLET_TYPES="legacy,hierarchical,sdk"
$env:CI_TRANSFER_LOVELACE="2000000"
$env:SIGN_BROADCAST="true"
```

Optional (recommended for full flow):

```powershell
Remove-Item Env:CI_ROUTE_SCENARIOS -ErrorAction SilentlyContinue
$env:CI_ROUTE_SCENARIOS=""
```

Start a clean CI-like stack:

If you changed local code or Dockerfiles, rebuild `app` and `ci-runner`; otherwise you can skip the `build` command for faster reruns.

```powershell
docker compose -f docker-compose.ci.yml down -v
docker compose -f docker-compose.ci.yml build app ci-runner
docker compose -f docker-compose.ci.yml up -d postgres app
```

Bootstrap wallets and write host-mounted artifacts:

```powershell
docker compose -f docker-compose.ci.yml run --rm `
  -e CI_CONTEXT_PATH=/artifacts/ci-wallet-context.json `
  ci-runner npx --yes tsx scripts/ci/create-wallets.ts
```

Run route-chain smoke scenarios:

```powershell
docker compose -f docker-compose.ci.yml run --rm `
  -e CI_CONTEXT_PATH=/artifacts/ci-wallet-context.json `
  -e CI_ROUTE_CHAIN_REPORT_PATH=/artifacts/ci-route-chain-report.json `
  ci-runner npx --yes tsx scripts/ci/run-route-chain.ts
```

View generated report on host:

```powershell
Get-Content ".\ci-artifacts\ci-route-chain-report.json"
```

## Local execution (Linux/Bash, CI-like)

From repo root:

- `/path/to/multisig`

Set required CI variables in your current shell:

```bash
export CI_JWT_SECRET="..."
export CI_MNEMONIC_1="..."
export CI_MNEMONIC_2="..."
export CI_MNEMONIC_3="..."
export CI_BLOCKFROST_PREPROD_API_KEY="..."
export CI_NETWORK_ID="0"
export CI_WALLET_TYPES="legacy,hierarchical,sdk"
export CI_TRANSFER_LOVELACE="2000000"
export SIGN_BROADCAST="true"
```

Optional (recommended for full flow):

```bash
unset CI_ROUTE_SCENARIOS
export CI_ROUTE_SCENARIOS=""
```

Start a clean CI-like stack:

If you changed local code or Dockerfiles, rebuild `app` and `ci-runner`; otherwise you can skip the `build` command for faster reruns.

```bash
docker compose -f docker-compose.ci.yml down -v
docker compose -f docker-compose.ci.yml build app ci-runner
docker compose -f docker-compose.ci.yml up -d postgres app
```

Bootstrap wallets and write host-mounted artifacts:

```bash
docker compose -f docker-compose.ci.yml run --rm \
  -e CI_CONTEXT_PATH=/artifacts/ci-wallet-context.json \
  ci-runner npx --yes tsx scripts/ci/create-wallets.ts
```

Run route-chain smoke scenarios:

```bash
docker compose -f docker-compose.ci.yml run --rm \
  -e CI_CONTEXT_PATH=/artifacts/ci-wallet-context.json \
  -e CI_ROUTE_CHAIN_REPORT_PATH=/artifacts/ci-route-chain-report.json \
  ci-runner npx --yes tsx scripts/ci/run-route-chain.ts
```

View generated report on host:

```bash
cat ./ci-artifacts/ci-route-chain-report.json
```
