# CI Route-Chain Test Suite

This folder contains the real-chain CI smoke system used by `.github/workflows/pr-multisig-v1-smoke.yml`.

## Why this exists

- Protects v1 API routes from regressions on pull requests.
- Verifies behavior against real blockchain conditions (preprod), not only mocked/unit paths.
- Keeps wallet bootstrap stable while allowing route tests to grow incrementally.
- Makes it easy to add new API route checks as composable scenario steps.

## High-level flow

CI runs these stages in order:

1. **Bootstrap** (`cli/bootstrap.ts`)
   - Derives signer addresses from mnemonic secrets.
   - Provisions one bot key per signer address.
   - Creates test wallets (`legacy`, `hierarchical`, `sdk`).
   - Grants all signer bots cosigner access to created wallets.
   - Writes a versioned context JSON consumed by all later steps.

2. **Route chain** (`cli/route-chain.ts`)
   - Loads and validates bootstrap context.
   - Loads enabled scenarios from `scenarios/manifest.ts`.
   - Executes steps in deterministic order with critical/non-critical failure semantics.
   - Emits console summary and machine-readable JSON report.

3. **Artifacts**
   - Route-chain JSON report is written to `ci-artifacts/ci-route-chain-report.json`.
   - Workflow uploads it as an artifact for triage.
   - Report now includes top-level `walletBalanceSummary` with total on-chain balances per wallet.

## Folder structure

- `cli/`
  - `bootstrap.ts`: stable setup stage, writes CI context.
  - `route-chain.ts`: main orchestrator for scenario execution.
  - `inspect-context.ts`: print bootstrap context summary (debug).
- `framework/`
  - `types.ts`: shared types for context/scenarios/reports.
  - `context.ts`: context loading + validation.
  - `env.ts`, `mnemonic.ts`, `walletType.ts`, `preprod.ts`: shared env and Cardano helpers.
  - `botProvision.ts`: bot key hashing for bootstrap.
  - `http.ts`: API caller helper with timeout/retry support.
  - `walletAuth.ts`: nonce + signer auth helper (`getNonce`/`authSigner`) and signer data signing.
  - `datumSign.ts`: reusable datum signing helper.
  - `governance.ts`: deterministic governance proposal selection and ballot payload builder.
  - `runner.ts`: scenario/step execution + report writing.
- `scenarios/`
  - `manifest.ts`: scenario registry and ordering only.
  - `flows/`: `signingFlow.ts`, `transferFlow.ts` (reusable multisig sign and real transfer builders).
  - `steps/`: route step factories grouped by area (`discovery.ts`, `botIdentity.ts`, `authPlane.ts`, `datum.ts`, `governance.ts`, `transferRing.ts`, …) plus `template-route-step.ts` for new steps.

### Subset runs (e.g. pending lifecycle only)

Use a comma-separated `CI_ROUTE_SCENARIOS` filter (same mechanism as the workflow dispatch input). For example, only the ring transfer + final checks:

```bash
CI_ROUTE_SCENARIOS=scenario.real-transfer-and-sign,scenario.final-assertions
```

Set `CI_ROUTE_CHAIN_REPORT_PATH` if you want a separate report file for that run.

## Current scenario intent

The manifest currently covers:

- route discovery (`walletIds`)
- route health checks (`freeUtxos`, `nativeScript`)
- bot identity (`botMe`)
- auth-plane checks (`getNonce`, `authSigner`)
- explicit auth negative checks (`walletIds`, `addTransaction`, `pendingTransactions`)
- datum route coverage (`submitDatum`)
- governance routes (`governanceActiveProposals`, `botBallotsUpsert`)
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
- CI bot keys are provisioned with scopes: `multisig:create`, `multisig:read`, `multisig:sign`, `governance:read`, `ballot:write`.

## Bootstrap context schema

`cli/bootstrap.ts` writes schema version `2`, with no persisted runtime secrets:

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

## Wallet balance summary in report

`ci-route-chain-report.json` includes a top-level `walletBalanceSummary` object that captures a single balance snapshot near report finalization:

- Source: direct on-chain UTxO lookup for each `wallet.walletAddress` from bootstrap context.
- Semantics: **total on-chain balance** (includes UTxOs even if currently referenced by pending multisig transactions).
- Quantities: stringified integer quantities (lovelace + native assets) to preserve precision.

Shape:

```json
{
  "walletBalanceSummary": {
    "capturedAt": "2026-01-01T00:00:00.000Z",
    "networkId": 0,
    "byWalletType": {
      "legacy": {
        "walletType": "legacy",
        "walletId": "wallet-id",
        "walletAddress": "addr_test...",
        "utxoCount": 2,
        "lovelace": "12345678",
        "assets": {
          "lovelace": "12345678"
        },
        "capturedAt": "2026-01-01T00:00:00.000Z",
        "networkId": 0
      }
    },
    "byWalletId": {
      "wallet-id": {
        "walletType": "legacy",
        "walletId": "wallet-id",
        "walletAddress": "addr_test...",
        "utxoCount": 2,
        "lovelace": "12345678",
        "assets": {
          "lovelace": "12345678"
        },
        "capturedAt": "2026-01-01T00:00:00.000Z",
        "networkId": 0
      }
    }
  }
}
```

If balance collection fails, `walletBalanceSummary.error` is populated and the report remains writable for triage.

## How to contribute

### Add a new route step

1. Copy `scenarios/steps/template-route-step.ts` into a new step module under `scenarios/steps/`.
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
- Prefer reusable helpers in `framework/` or `scenarios/flows/`.
- Keep step ids stable (helps CI history and triage).
- Avoid hidden randomness in assertions; use deterministic checks.
- For governance scenarios, derive proposal lists via `framework/governance.ts` so payload shape and proposal selection remain deterministic across step reruns.

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
  ci-runner npx --yes tsx scripts/ci/cli/bootstrap.ts
```

Run route-chain smoke scenarios:

```powershell
docker compose -f docker-compose.ci.yml run --rm `
  -e CI_CONTEXT_PATH=/artifacts/ci-wallet-context.json `
  -e CI_ROUTE_CHAIN_REPORT_PATH=/artifacts/ci-route-chain-report.json `
  ci-runner npx --yes tsx scripts/ci/cli/route-chain.ts
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
  ci-runner npx --yes tsx scripts/ci/cli/bootstrap.ts
```

Run route-chain smoke scenarios:

```bash
docker compose -f docker-compose.ci.yml run --rm \
  -e CI_CONTEXT_PATH=/artifacts/ci-wallet-context.json \
  -e CI_ROUTE_CHAIN_REPORT_PATH=/artifacts/ci-route-chain-report.json \
  ci-runner npx --yes tsx scripts/ci/cli/route-chain.ts
```

View generated report on host:

```bash
cat ./ci-artifacts/ci-route-chain-report.json
```
