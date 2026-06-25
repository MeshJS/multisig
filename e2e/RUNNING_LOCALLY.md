# Running the Playwright E2E Tests Locally

The ring-transfer suite drives a real Cardano preprod browser flow:
CIP-0030 wallet injection -> transaction propose -> multi-sign -> on-chain broadcast.

Use the Docker flow below when you want the local run to match CI. It starts Postgres,
starts the app, bootstraps the three CI wallets, then runs Playwright against the app
container.

## Prerequisites

| Requirement | Notes |
|---|---|
| Docker + Docker Compose | Manages Postgres, app, bootstrap runner, and Playwright runner |
| Three funded preprod mnemonics | Each wallet should hold at least 5 ADA for fees |
| Blockfrost preprod API key | From https://blockfrost.io |
| JWT secret | At least 32 characters; used as `JWT_SECRET` in the app |

## 1. Create `.env.playwright`

Create `.env.playwright` in the repo root. Do not commit it.

```dotenv
CI_JWT_SECRET=your-jwt-secret-min-32-chars
CI_MNEMONIC_1="word1 word2 word3 ... word24"
CI_MNEMONIC_2="word1 word2 word3 ... word24"
CI_MNEMONIC_3="word1 word2 word3 ... word24"
CI_BLOCKFROST_PREPROD_API_KEY=preprodXXXXXXXXXXXXXXXXXX
CI_NETWORK_ID=0
CI_NUM_REQUIRED_SIGNERS=2
CI_WALLET_TYPES=legacy,hierarchical,sdk
CI_TRANSFER_LOVELACE=2000000
```

## 2. First Clean Run

Run these commands in order from the repo root.

### PowerShell

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build app bootstrap-runner playwright-runner
docker compose -f docker-compose.playwright.yml --env-file .env.playwright up -d postgres app
docker compose -f docker-compose.playwright.yml --env-file .env.playwright ps
```

Wait until `multisig-app-1` shows `healthy`.

```powershell
New-Item -ItemType Directory -Force ci-artifacts | Out-Null
docker compose -f docker-compose.playwright.yml --env-file .env.playwright `
    --profile playwright run --rm bootstrap-runner

docker compose -f docker-compose.playwright.yml --env-file .env.playwright `
    --profile playwright run --rm --no-deps playwright-runner
```

### Bash

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build app bootstrap-runner playwright-runner
docker compose -f docker-compose.playwright.yml --env-file .env.playwright up -d postgres app
docker compose -f docker-compose.playwright.yml --env-file .env.playwright ps
```

Wait until `multisig-app-1` shows `healthy`.

```bash
mkdir -p ci-artifacts
docker compose -f docker-compose.playwright.yml --env-file .env.playwright \
  --profile playwright run --rm bootstrap-runner

docker compose -f docker-compose.playwright.yml --env-file .env.playwright \
  --profile playwright run --rm --no-deps playwright-runner
```

Bootstrap creates `ci-artifacts/ci-wallet-context.json`. The Playwright runner reads
that file, so bootstrap must run before the test runner.

Use `--no-deps` when running `playwright-runner` after bootstrap. Without it, Docker
Compose may try to run dependency services again, including bootstrap.

## 3. Rerun After Changes

Pick the smallest path that matches what changed.

| What changed? | Commands to run |
|---|---|
| Only `e2e/` or `scripts/ci/framework/` | Run only `playwright-runner`; these paths are volume-mounted |
| `src/`, `prisma/`, app env, or other app code | Rebuild `app`, restart `app`, then run `playwright-runner` |
| `package.json`, `package-lock.json`, `tsconfig*.json`, or `Dockerfile.playwright` | Rebuild `playwright-runner`, then run `playwright-runner` |
| Wallet context is stale, wrong, or DB data is dirty | Tear down with `down -v`, then repeat the first clean run |

### Only test/framework changes

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright `
    --profile playwright run --rm --no-deps playwright-runner
```

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright \
  --profile playwright run --rm --no-deps playwright-runner
```

### App code changes

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build app
docker compose -f docker-compose.playwright.yml --env-file .env.playwright up -d app
docker compose -f docker-compose.playwright.yml --env-file .env.playwright `
    --profile playwright run --rm --no-deps playwright-runner
```

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build app
docker compose -f docker-compose.playwright.yml --env-file .env.playwright up -d app
docker compose -f docker-compose.playwright.yml --env-file .env.playwright \
  --profile playwright run --rm --no-deps playwright-runner
```

### Runner dependency changes

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build playwright-runner
docker compose -f docker-compose.playwright.yml --env-file .env.playwright `
    --profile playwright run --rm --no-deps playwright-runner
```

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build playwright-runner
docker compose -f docker-compose.playwright.yml --env-file .env.playwright \
  --profile playwright run --rm --no-deps playwright-runner
```

## Useful Commands

### Check app health

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright ps
```

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright ps
```

### Poll app health automatically

PowerShell:

```powershell
do {
    docker compose -f docker-compose.playwright.yml exec app `
        node -e "fetch('http://localhost:3000/api/swagger').then(r=>process.exit(r.ok?0:1))" 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Host "waiting..."; Start-Sleep 5 }
} until ($LASTEXITCODE -eq 0)
```

Bash:

```bash
until docker compose -f docker-compose.playwright.yml exec app \
  node -e "fetch('http://localhost:3000/api/swagger').then(r=>process.exit(r.ok?0:1))"; \
  do echo "waiting..."; sleep 5; done
```

### View the HTML report

Artifacts are written to `ci-artifacts/`.

```bash
npx playwright show-report ci-artifacts/playwright-report
```

### Tear down

Use this when you want a fresh database and wallet context.

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright down -v --remove-orphans
```

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright down -v --remove-orphans
```

## Environment Variable Reference

| Variable | Required | Description |
|---|---|---|
| `CI_JWT_SECRET` | Yes | Must equal the app's `JWT_SECRET`. Used to sign wallet-session cookies in the fast-auth path. |
| `CI_MNEMONIC_1` | Yes | 24-word mnemonic for signer 0, the proposer. |
| `CI_MNEMONIC_2` | Yes | 24-word mnemonic for signer 1. |
| `CI_MNEMONIC_3` | Yes | 24-word mnemonic for signer 2. |
| `CI_BLOCKFROST_PREPROD_API_KEY` | Yes | Blockfrost preprod API key, usually starting with `preprod`. |
| `CI_CONTEXT_PATH` | Yes in containers | Path where bootstrap writes and tests read `ci-wallet-context.json`; provided by Docker Compose. |
| `APP_URL` | No | Base URL of the running app; provided by Docker Compose for the runner. |
| `CI_TRANSFER_LOVELACE` | No | Lovelace sent per ring-transfer leg. Defaults to `2000000` (2 ADA). |
| `CI_NETWORK_ID` | No | `0` for preprod. Defaults to `0`. |
| `CI_NUM_REQUIRED_SIGNERS` | No | Signing threshold. Defaults to `2`. |
| `CI_WALLET_TYPES` | No | Comma-separated wallet types. Defaults to `legacy,hierarchical,sdk`. |
| `PLAYWRIGHT_WORKERS` | No | Number of parallel Playwright workers. Defaults to `3` (one per ring-transfer leg). Set to `1` for serial execution. |

## How the Test Works

1. Bootstrap creates three multisig wallets (`legacy`, `hierarchical`, and `sdk`) in
   the app DB and writes their wallet IDs, script addresses, and signer addresses to
   `ci-wallet-context.json`.

2. `global-setup.ts` validates env vars and caches the context JSON for the test run.

3. `ring-transfer.spec.ts` runs three legs in parallel, one Playwright worker
   per leg. For each leg:
   - Signer 0 proposes a transaction from `/wallets/{id}/transactions/new`.
   - The `window.cardano.meshci` mock intercepts `signTx` and bridges to
     `MeshWallet.signTx` in Node.js using the corresponding mnemonic.
   - Signer 1 signs from `/wallets/{id}/transactions`, reaching the 2-of-3 threshold
     and broadcasting on-chain.
   - The test waits for `[data-testid="tx-broadcast-success"]` and confirms the pending
     transaction is cleared via `/api/v1/pendingTransactions`.

4. Legs run in parallel. Each leg spends from a different multisig wallet
   (legacy, hierarchical, sdk), so the legs never compete for the same UTxOs.
   Each source wallet must independently hold enough ADA for its transfer plus
   fees; if a previous run left a wallet short, the leg waits up to 5 minutes
   for the concurrently running leg that refills it. Set `PLAYWRIGHT_WORKERS=1`
   to fall back to serial execution.

## Troubleshooting

**`CI_CONTEXT_PATH must be set`** - bootstrap did not run before the Playwright runner.
Run bootstrap, then run `playwright-runner` with `--no-deps`.

**`Missing required environment variables`** - one of the required env vars is missing.
Check `.env.playwright`.

**`No legacy/hierarchical/sdk wallet found`** - the bootstrap context is stale or was
written by an older schema. Tear down with `down -v --remove-orphans`, then repeat the
first clean run.

**`This address is already registered to another bot`** - the DB still has wallets from
a previous run. Tear down with `down -v --remove-orphans`, then repeat the first clean
run.

**`utxo-selector[data-loaded="true"]` timeout** - the app could not fetch UTxOs from
Blockfrost. Confirm `CI_BLOCKFROST_PREPROD_API_KEY` is a valid preprod key and the
wallets have UTxOs. If the key changed, rebuild and restart the `app` service because
`next build` bakes `NEXT_PUBLIC_*` vars into the client bundle at image build time
(they are passed as Docker build args from `.env.playwright`).

**Blank black page / no `Connect Wallet` button** - the browser bundle likely built
without required public env vars. Rebuild and restart `app`:

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build app
docker compose -f docker-compose.playwright.yml --env-file .env.playwright up -d app
```

**`net::ERR_SSL_PROTOCOL_ERROR`** - `.app` is on Chromium's HSTS preload list, so
`http://app:*` is upgraded to HTTPS. The Compose file uses the `webapp` network alias
and the runner uses `http://webapp:3000`. Confirm both are still configured.

**Wallet not found in connect modal** - `window.cardano.meshci` was not injected before
the page loaded. Check fixture order in `authFixture.ts`.

**Transaction still pending after broadcast timeout** - preprod may be congested, or
the wallet may lack enough ADA for fees. Check wallet balances on preprod Cardanoscan.
