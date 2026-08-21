# Running the Playwright E2E Tests Locally

The Playwright runner is the single local entry point for browser E2E tests in
`e2e/tests`. The suite includes the ring-transfer specs, which drive a real
Cardano preprod browser flow
(CIP-0030 wallet injection -> transaction propose -> multi-sign -> on-chain broadcast),
plus UI specs covering wallet creation, new-transaction validation, rejected
signing, staking, governance/DRep, proxies, bot management, notification
settings, wallet access control, and responsive smoke checks.

Use the Docker flow below when you want the local run to match CI
(`.github/workflows/pr-playwright-browser.yml`). It starts Postgres,
starts the app, bootstraps the three CI wallets, then runs the full Playwright suite
against the app container.

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
# Hex (28-byte) preprod pool id — required by the staking-ui spec.
CI_STAKE_POOL_ID_HEX=f9c8e7275348d3b1a3596c94095f43307990cc5f800bbbb256298658
```

Keep every value on a single line: `docker compose --env-file` cannot parse
multi-line values, and one malformed entry breaks the whole file. The browser
governance spec and route-chain runner both expect `CI_DREP_ANCHOR_JSON` to stay
single-line minified JSON if you keep it in this file.

## 2. First Clean Run

Run these commands in order from the repo root.

### PowerShell

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build app bootstrap-runner
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build playwright-runner
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
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build app bootstrap-runner
docker compose -f docker-compose.playwright.yml --env-file .env.playwright build playwright-runner
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

Do not continue after a failed or canceled image build. In particular, if the
`playwright-runner` image fails during `npm ci`, rebuild it after the registry
recovers before running tests; if the `app` build is canceled, rebuild `app` before
`up -d postgres app`. Otherwise Docker may start an older app image whose browser
bundle is missing the `.env.playwright` `NEXT_PUBLIC_*` values.

Use `--no-deps` when running `playwright-runner` after bootstrap. Without it, Docker
Compose may try to run dependency services again, including bootstrap.

By default, `playwright-runner` executes all specs under `e2e/tests` using
`e2e/playwright.config.ts`. As new Playwright specs are added, they should be runnable
through this same command unless they intentionally require a different setup.

## 3. Rerun After Changes

Pick the smallest path that matches what changed.

| What changed? | Commands to run |
|---|---|
| Only `e2e/` or `scripts/ci/framework/` | Run only `playwright-runner`; these paths are volume-mounted |
| `src/`, `prisma/`, app env, or other app code | Rebuild `app`, restart `app`, then run `playwright-runner` |
| `package.json`, `package-lock.json`, `tsconfig*.json`, or `Dockerfile.playwright` | Rebuild `playwright-runner`, then run `playwright-runner` |
| Wallet context is stale, wrong, or DB data is dirty | Tear down with `down -v`, then repeat the first clean run |

### Only test/framework changes

Runs the full Playwright suite:

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright `
    --profile playwright run --rm --no-deps playwright-runner
```

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright \
  --profile playwright run --rm --no-deps playwright-runner
```

### Run a focused spec

Use this when iterating on one Playwright file while keeping the same Docker app,
database, wallet context, and artifact paths.

PowerShell:

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright `
    --profile playwright run --rm --no-deps playwright-runner `
    npx playwright test --config=e2e/playwright.config.ts e2e/tests/ring-transfer.spec.ts
```

Bash:

```bash
docker compose -f docker-compose.playwright.yml --env-file .env.playwright \
  --profile playwright run --rm --no-deps playwright-runner \
  npx playwright test --config=e2e/playwright.config.ts e2e/tests/ring-transfer.spec.ts
```

Replace `e2e/tests/ring-transfer.spec.ts` with any spec path under `e2e/tests`.

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

Artifacts are written to `ci-artifacts/`. Failure traces, screenshots, and videos
land in `ci-artifacts/playwright-traces/`.

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
| `CI_STAKE_POOL_ID_HEX` | Yes for `staking-ui.spec.ts` | Hex (28-byte) preprod stake pool id. A bech32 `pool1...` value is normalized in-test, but bootstrap and route-chain expect hex. Forwarded to both the bootstrap and Playwright runners. |
| `CI_DREP_ANCHOR_URL` | No | Not read by any current spec; Docker Compose forwards it to the runner only for parity. Required separately by the route-chain CI runner. |
| `CI_DREP_ANCHOR_JSON` | Yes for `governance-drep-ui.spec.ts` | CIP-119 anchor JSON used to fill the DRep register/update validation forms. It must stay single-line JSON because `docker compose --env-file` cannot parse multi-line values. |
| `CI_NETWORK_ID` | No | `0` for preprod. Defaults to `0`. |
| `CI_NUM_REQUIRED_SIGNERS` | No | Signing threshold. Defaults to `2`. |
| `CI_WALLET_TYPES` | No | Comma-separated wallet types. Defaults to `legacy,hierarchical,sdk`. |
| `PLAYWRIGHT_WORKERS` | No | Number of parallel Playwright workers. Defaults to `3` (one per ring-transfer leg). Set to `1` for serial execution. |

## How the Suite Works

1. Bootstrap creates three multisig wallets (`legacy`, `hierarchical`, and `sdk`) in
   the app DB and writes their wallet IDs, script addresses, and signer addresses to
   `ci-wallet-context.json`.

2. `global-setup.ts` validates env vars and caches the context JSON for the test run.

3. Playwright runs every spec in `e2e/tests` unless you pass a focused spec path.
   Specs should reuse the existing fixtures and bootstrap context when possible so the
   Docker runner remains the one local place to exercise browser coverage.

4. `ring-transfer.spec.ts` runs three legs in parallel, one Playwright worker
   per leg. For each leg:
   - Signer 0 proposes a transaction from `/wallets/{id}/transactions/new`.
   - The test verifies the pending transaction is still below threshold and only the
     proposer has signed before the second signer acts.
   - The `window.cardano.meshci` mock intercepts `signTx` and bridges to
     `MeshWallet.signTx` in Node.js using the corresponding mnemonic.
   - Signer 1 signs from `/wallets/{id}/transactions`, reaching the 2-of-3 threshold
     and broadcasting on-chain.
   - The test waits for `[data-testid="tx-broadcast-success"]` and confirms the pending
     transaction is cleared via `/api/v1/pendingTransactions`.

5. Ring-transfer legs run in parallel. Each leg spends from a different multisig wallet
   (legacy, hierarchical, sdk), so the legs never compete for the same UTxOs.
   Each source wallet must independently hold enough ADA for its transfer plus
   fees; if a previous run left a wallet short, the leg waits up to 5 minutes
   for the concurrently running leg that refills it. Set `PLAYWRIGHT_WORKERS=1`
   to fall back to serial execution.

When adding new specs, keep their state isolated from ring-transfer where possible.
The default worker count is `3` because the ring legs are designed to run in parallel;
set `PLAYWRIGHT_WORKERS=1` for serial debugging or for a new spec that is not yet
parallel-safe.

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

This can happen after a build log containing `RUN npm ci ... exit code: 146` followed
by `RUN npm run build CANCELED`: the runner image had a network install failure and
the app image build was canceled, so the next `up` reused an older app image.

**`net::ERR_SSL_PROTOCOL_ERROR`** - `.app` is on Chromium's HSTS preload list, so
`http://app:*` is upgraded to HTTPS. The Compose file uses the `webapp` network alias
and the runner uses `http://webapp:3000`. Confirm both are still configured.

**Wallet not found in connect modal** - `window.cardano.meshci` was not injected before
the page loaded. Check fixture order in `authFixture.ts`.

**Transaction still pending after broadcast timeout** - preprod may be congested, or
the wallet may lack enough ADA for fees. Check wallet balances on preprod Cardanoscan.
