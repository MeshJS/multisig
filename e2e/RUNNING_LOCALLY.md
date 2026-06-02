# Running the Playwright E2E Tests Locally

The ring-transfer test suite drives a real Cardano **preprod** browser flow:
CIP-0030 wallet injection → transaction propose → multi-sign → on-chain broadcast.
It requires live preprod wallets with funded UTxOs and a Blockfrost preprod API key.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Docker + Docker Compose | Manages postgres, app, and Playwright runner |
| Three funded preprod mnemonics | Each wallet must hold ≥ 5 ADA to cover fees |
| Blockfrost preprod API key | From [blockfrost.io](https://blockfrost.io) |
| A JWT secret (≥ 32 chars) | Must match what the app uses as `JWT_SECRET` |

---

## Running (PowerShell — Docker, matches CI)

This replicates exactly what runs in CI.

### 1. Create `.env.playwright`

Create a `.env.playwright` file in the repo root (not committed):

```
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

### 2. Build the images

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build app playwright-runner
```

### 3. Start postgres and the app

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright up -d postgres app
```

Wait for the app to become healthy (the healthcheck polls `/api/swagger`):

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright ps
# Repeat until app shows "healthy"
```

Or poll until healthy automatically:

```powershell
do {
    docker compose -f docker-compose.playwright.yml exec app `
        node -e "fetch('http://localhost:3000/api/swagger').then(r=>process.exit(r.ok?0:1))" 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Host "waiting..."; Start-Sleep 5 }
} until ($LASTEXITCODE -eq 0)
```

### 4. Run bootstrap (creates the three CI wallets in the DB)

```powershell
New-Item -ItemType Directory -Force ci-artifacts | Out-Null
docker compose -f docker-compose.playwright.yml --env-file .env.playwright `
    --profile playwright run --rm bootstrap-runner
```

This writes `ci-artifacts/ci-wallet-context.json` — the shared context that both the Playwright runner and the ring-transfer test read.

### 5. Run the Playwright tests

Use `--no-deps` so Docker Compose does not re-run the bootstrap service (it already completed in step 4). No rebuild is needed — `e2e/` and `scripts/ci/framework/` are volume-mounted into the runner so local changes are always live:

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright `
    --profile playwright run --rm --no-deps playwright-runner
```

Artifacts land in `ci-artifacts/`:
- `ci-artifacts/playwright-report/` — HTML report (`index.html`)
- `ci-artifacts/playwright-traces/` — video/trace on failure

> **Rebuild only when needed:** if you change `package.json`, `tsconfig*.json`, or the Playwright/Chromium version in `Dockerfile.playwright`, rebuild with:
> ```powershell
> docker compose -f docker-compose.playwright.yml --env-file .env.playwright build playwright-runner
> ```

### 6. Tear down

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright down -v --remove-orphans
```

---

## Running (Bash — Docker, matches CI)

This replicates exactly what runs in CI.

### 1. Create `.env.playwright`

Create a `.env.playwright` file in the repo root (not committed):

```
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

### 2. Build the images

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build app playwright-runner
```

### 3. Start postgres and the app

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright up -d postgres app
```

Wait for the app to become healthy (the healthcheck polls `/api/swagger`):

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright ps
# Repeat until app shows "healthy"
```

Or poll until healthy automatically:

```bash
until docker compose -f docker-compose.playwright.yml exec app \
  node -e "fetch('http://localhost:3000/api/swagger').then(r=>process.exit(r.ok?0:1))"; \
  do echo "waiting..."; sleep 5; done
```

### 4. Run bootstrap (creates the three CI wallets in the DB)

```bash
mkdir -p ci-artifacts
docker compose -f docker-compose.playwright.yml --env-file .env.playwright \
  --profile playwright run --rm bootstrap-runner
```

This writes `ci-artifacts/ci-wallet-context.json` — the shared context that both the Playwright runner and the ring-transfer test read.

### 5. Run the Playwright tests

Use `--no-deps` so Docker Compose does not re-run the bootstrap service (it already completed in step 4). No rebuild is needed — `e2e/` and `scripts/ci/framework/` are volume-mounted into the runner so local changes are always live:

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright \
  --profile playwright run --rm --no-deps playwright-runner
```

Artifacts land in `ci-artifacts/`:
- `ci-artifacts/playwright-report/` — HTML report (`index.html`)
- `ci-artifacts/playwright-traces/` — video/trace on failure

> **Rebuild only when needed:** if you change `package.json`, `tsconfig*.json`, or the Playwright/Chromium version in `Dockerfile.playwright`, rebuild with:
> ```bash
> docker compose -f docker-compose.playwright.yml --env-file .env.playwright build playwright-runner
> ```

### 6. Tear down

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright down -v --remove-orphans
```

---

## Viewing the HTML Report

After any run, open the report in your browser:

```bash
npx playwright show-report ci-artifacts/playwright-report
# or, for a local run:
npx playwright show-report playwright-report
```

---

## Environment Variable Reference

| Variable | Required | Description |
|---|---|---|
| `CI_JWT_SECRET` | Yes | Must equal the app's `JWT_SECRET`. Used to sign wallet-session cookies in the fast-auth path. |
| `CI_MNEMONIC_1` | Yes | 24-word mnemonic for signer 0 (proposer). |
| `CI_MNEMONIC_2` | Yes | 24-word mnemonic for signer 1. |
| `CI_MNEMONIC_3` | Yes | 24-word mnemonic for signer 2. |
| `CI_BLOCKFROST_PREPROD_API_KEY` | Yes | Blockfrost preprod API key (`preprod...`). |
| `CI_CONTEXT_PATH` | Yes | Path where bootstrap writes/test reads `ci-wallet-context.json`. |
| `APP_URL` | No | Base URL of the running app. Defaults to `http://localhost:3000`. |
| `CI_TRANSFER_LOVELACE` | No | Lovelace sent per ring-transfer leg. Defaults to `2000000` (2 ADA). |
| `CI_NETWORK_ID` | No (bootstrap only) | `0` for preprod. Defaults to `0`. |
| `CI_NUM_REQUIRED_SIGNERS` | No (bootstrap only) | Signing threshold. Defaults to `2`. |
| `CI_WALLET_TYPES` | No (bootstrap only) | Comma-separated wallet types. Defaults to `legacy,hierarchical,sdk`. |

---

## How the Test Works

1. **Bootstrap** creates three multisig wallets (legacy / hierarchical / sdk) in the
   app DB and writes their wallet IDs, script addresses, and signer addresses to
   `ci-wallet-context.json`.

2. **global-setup.ts** validates env vars and caches the context JSON for the test run.

3. **ring-transfer.spec.ts** runs three sequential legs. For each leg:
   - Signer 0 (proposer) navigates to `/wallets/{id}/transactions/new`, fills the
     recipient address and ADA amount, and submits. The `window.cardano.meshci` mock
     intercepts `signTx` and bridges to `MeshWallet.signTx` in the Node.js context
     using the corresponding mnemonic.
   - Signer 1 navigates to `/wallets/{id}/transactions`, clicks the sign button, which
     reaches the 2-of-3 threshold and broadcasts the transaction on-chain.
   - The test waits for `[data-testid="tx-broadcast-success"]` and confirms the pending
     tx is cleared from the DB via `/api/v1/pendingTransactions`.

4. Legs run **serially** (`test.describe.serial`) to avoid UTxO conflicts between legs.

---

## Troubleshooting

**`CI_CONTEXT_PATH must be set`** — bootstrap did not run before the Playwright runner.
Run steps 4 → 5 in order.

**`Missing required environment variables`** — one of the required env vars is missing.
Check your `.env.playwright`.

**`No legacy/hierarchical/sdk wallet found`** — the bootstrap context is stale or
written by an older schema. Run step 6 (tear down) then repeat steps 3 → 5.

**`This address is already registered to another bot`** (bootstrap fails) — the DB still
has wallets from a previous run. The postgres volume was not removed. Run step 6 with
`-v` (`down -v --remove-orphans`) then repeat steps 3 → 5.

**`utxo-selector[data-loaded="true"]` timeout** — the app could not fetch UTxOs from
Blockfrost. Confirm `CI_BLOCKFROST_PREPROD_API_KEY` is a valid preprod key and the
wallets have UTxOs. Also confirm you ran the `build` step (step 2) with
`--env-file .env.playwright` — the Next.js dev server bakes `NEXT_PUBLIC_*` vars into
the client bundle at first compile; if the key was missing then, it stays missing until
you rebuild and restart.

**`net::ERR_SSL_PROTOCOL_ERROR`** — `.app` is a Google-managed gTLD that is on
Chromium's HSTS preload list. Every `http://app:*` request is silently upgraded to
`https://` by the browser before leaving the process. The docker-compose sets a `webapp`
network alias on the app service and the playwright-runner connects via
`http://webapp:3000` to avoid this. If you see this error, confirm your
`docker-compose.playwright.yml` has the `webapp` alias on the `app` service's network
config and that `APP_URL` is set to `http://webapp:3000` in the `playwright-runner`
environment.

**Wallet not found in connect modal** — the `window.cardano.meshci` object was not
injected before the page loaded. This usually means `injectWallet()` was not called
before `page.goto()`. Check fixture order in `authFixture.ts`.

**Transaction still pending after broadcast timeout** — the preprod network may be
congested, or the wallet lacks sufficient ADA for fees. Check wallet balances via
[preprod.cardanoscan.io](https://preprod.cardanoscan.io).
