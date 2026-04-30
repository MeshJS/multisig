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
   - Derives signer payment addresses from mnemonic secrets and matching stake (reward) addresses from those base addresses.
   - Provisions one bot key per signer address.
   - Creates test wallets (`legacy`, `hierarchical`, `sdk`).
   - For **SDK** wallets, always attaches `signersStakeKeys` so the wallet matches production “SDK multisig” staking (native script role `2` alongside payment `0` and DRep `3`).
   - Grants all signer bots cosigner access to created wallets.
   - Writes a versioned context JSON consumed by all later steps.

2. **Route chain** (`cli/route-chain.ts`)
   - Loads and validates bootstrap context.
   - Loads enabled scenarios from `scenarios/manifest.ts`.
   - Executes steps in deterministic order with critical/non-critical failure semantics.
   - Emits console summary and machine-readable JSON report.

3. **Artifacts**
   - Route-chain Markdown report is written to `ci-artifacts/ci-route-chain-report.md`.
   - Workflow uploads it as an artifact for triage.
   - Report contains a run summary header, wallet balance table, scenario summary table, and per-scenario step tables. Failed steps include error/artifact code blocks.

## Folder structure

- `cli/`
  - `bootstrap.ts`: stable setup stage, writes CI context.
  - `wallet-status.ts`: print multisig wallet addresses and on-chain balances (after bootstrap, before route-chain).
  - `route-chain.ts`: main orchestrator for scenario execution.
  - `inspect-context.ts`: print bootstrap context summary (debug).
- `framework/`
  - `types.ts`: shared types for context/scenarios/reports.
  - `context.ts`: context loading + validation.
  - `env.ts`, `mnemonic.ts`, `walletType.ts`, `preprod.ts`: shared env and Cardano helpers.
  - `botProvision.ts`: bot key hashing for bootstrap.
  - `botAuth.ts`: bot JWT authentication with in-process token caching (10 s expiry margin) and 429-rate-limit retry.
  - `botContext.ts`: bot selection helpers (`getDefaultBot`, `getBotForAddress`, `getBotForSignerIndex`).
  - `http.ts`: API caller helper with timeout/retry support.
  - `walletAuth.ts`: nonce + signer auth helper (`getNonce`/`authSigner`) and signer data signing.
  - `datumSign.ts`: reusable datum signing helper.
  - `governance.ts`: deterministic governance proposal selection and ballot payload builder.
  - `runner.ts`: scenario/step execution + report writing.
  - `walletBalances.ts`: on-chain UTxO balance collection via Blockfrost (used by `walletBalanceSummary` in report).
  - `redact.ts`: recursive sensitive-value redaction for log-safe JSON serialisation.
- `scenarios/`
  - `manifest.ts`: scenario registry and ordering only.
  - `proxyLifecyclePreflight.ts`: proxy lifecycle ADA/UTxO budget constants and shape analysis.
  - `flows/`: `signingFlow.ts`, `transferFlow.ts`, `certificateSigningFlow.ts`, `utxoShapeFlow.ts` (reusable multisig sign, real transfer builders, stake-cert signing with dual payment+stake witnesses, and proxy lifecycle self-split shaping).
  - `steps/`: route step factories grouped by area (`discovery.ts`, `botIdentity.ts`, `authPlane.ts`, `datum.ts`, `governance.ts`, `transferRing.ts`, `certificates.ts`, `walletLifecycle.ts`, `proxyBot.ts`, …) plus `helpers.ts` (ring wallet-type utilities) and `template-route-step.ts` for new steps.

### Full scenario execution order

The manifest runs scenarios in this fixed sequence:

| # | Scenario ID | Conditional |
|---|-------------|-------------|
| 1 | `scenario.wallet-discovery` | always |
| 2 | `scenario.ada-route-health` | always |
| 3 | `scenario.create-wallet` | always |
| 4 | `scenario.bot-identity` | always |
| 5 | `scenario.auth-plane` | always |
| 6 | `scenario.proxy-smoke` | always |
| 7 | `scenario.submit-datum` | always |
| 8 | `scenario.governance-routes` | always |
| 9 | `scenario.drep-certificates` | legacy + sdk wallets present |
| 10 | `scenario.stake-certificates` | sdk wallet present |
| 11 | `scenario.proxy-full-lifecycle` | legacy and/or sdk wallets present |
| 12 | `scenario.real-transfer-and-sign` | always (all 3 wallet types required) |
| 13 | `scenario.final-assertions` | always |

Certificate scenarios (9–10) run before the ring transfer so they spend confirmed UTxOs; the ring transfer would put those UTxOs in the mempool and create a race.

### Subset runs

Use a comma-separated `CI_ROUTE_SCENARIOS` filter (same mechanism as the workflow dispatch input).

Quick auth + discovery smoke (no on-chain transfers, finishes in seconds):

```bash
CI_ROUTE_SCENARIOS=scenario.wallet-discovery,scenario.ada-route-health,scenario.bot-identity,scenario.auth-plane,scenario.proxy-smoke
```

Wallet creation API only:

```bash
CI_ROUTE_SCENARIOS=scenario.create-wallet
```

Ring transfer + final checks only:

```bash
CI_ROUTE_SCENARIOS=scenario.real-transfer-and-sign,scenario.final-assertions
```

Set `CI_ROUTE_CHAIN_REPORT_PATH` if you want a separate report file for that run.

## Current scenario intent

The manifest currently covers:

- route discovery (`walletIds`, `proxies`)
- **pending-transactions zero-check** at bootstrap for each wallet type — catches stale state from a previous incomplete run before the ring transfer begins
- **public wallet lookup** (`lookupMultisigWallet`) — smoke-tests the unauthenticated on-chain metadata lookup endpoint
- route health checks (`freeUtxos`, `nativeScript`) — `nativeScript` now asserts a `payment` script entry is present and, when the root type is `atLeast`, that `required` matches `CI_NUM_REQUIRED_SIGNERS`
- **wallet creation via API** (`createWallet`) — creates a wallet through the bot-authenticated API path and confirms it appears in `walletIds`; runs early to avoid prior default-bot smoke checks consuming the shared bot rate-limit budget
- bot identity (`botAuth` explicit response shape, `botMe`)
- auth-plane checks (`getNonce`, `authSigner`)
- explicit auth negative checks (`walletIds`, `addTransaction`, `pendingTransactions`, `drepInfo`, `stakeAccountInfo`, `createWallet`) — `drepInfo`/`stakeAccountInfo`/`createWallet` check for missing token (401); `walletIds`/`addTransaction` check for address mismatch (403); `pendingTransactions` checks for missing token (401)
- proxy smoke checks (`proxies`, malformed proxy mutating routes) plus full proxy lifecycle coverage (`proxySetup`, `proxySpend`, proxy DRep register/deregister, optional proxy vote, cleanup, finalization)
- **`signTransaction` input validation** — asserts a non-existent `transactionId` returns 404, not 500 (requires `CI_MNEMONIC_2`; step is non-critical and skips gracefully if the env var is absent)
- datum route coverage (`submitDatum`)
- governance routes (`governanceActiveProposals`, `botBallotsUpsert`)
- **DRep certificate registration and retirement** (`botDRepCertificate`) — legacy and SDK wallets
- **stake certificate registration and deregistration** (`botStakeCertificate`) — SDK wallet only
- real multisig-wallet ring transfer + sign path
- pending lifecycle assertions for ring transfer txs only
- final state assertions after transfer/sign progression

### Proxy bot scenarios

`scenario.proxy-smoke` runs by default and performs authenticated `proxies` read checks plus negative validation checks that should fail before chain mutation.

`scenario.proxy-full-lifecycle` runs by default in PR smoke for `legacy` and `sdk` wallets only. It starts each eligible wallet type with three pre-hygiene steps before normal setup: chain recovery reconstructs missing `Proxy` rows from proxy auth tokens still visible at the current CI wallet address, row adoption reattaches valid rows from historical deterministic CI wallets, and hygiene cleans any active rows before the new lifecycle begins. It then runs UTxO shaping and a funding preflight that fetches fresh `freeUtxos`. The hardcoded lifecycle budget is 536 ADA: 505 ADA DRep registration, 10 ADA initial proxy funding, 1 ADA planned proxy spend, and a 20 ADA fee buffer. Because collateral is reserved outside selected spend inputs, the practical minimum post-shape layout is at least 536 ADA selectable at the multisig wallet address plus a separate ADA-only bot payment-address collateral UTxO. The self-split path needs enough total ADA to leave that 536 ADA selectable budget, create a 6 ADA collateral output, and cover a 2 ADA self-split fee buffer. Proxy DRep registration uses `CI_DREP_ANCHOR_URL` as the on-chain anchor URL and sends an inline route-chain `anchorJson`; it does not use `CI_DREP_ANCHOR_JSON`.

The first full-lifecycle steps for each eligible wallet type are ordered as:

1. `v1.proxy.full.recoverFromChain.<walletType>`
2. `v1.proxy.full.adoptOrphans.<walletType>`
3. `v1.proxy.full.hygiene.<walletType>`
4. `v1.proxy.full.utxoShape.<walletType>`
5. `v1.proxy.full.preflight.<walletType>`

Chain recovery is CI-only and evidence-based. It scans non-lovelace assets at the current bootstrap `walletAddress`, asks Blockfrost for each asset's mint transaction, tests the mint transaction inputs as candidate `paramUtxo` values with `deriveProxyScripts`, and only creates or reactivates a `Proxy` row when the derived `authTokenId` exactly matches the observed asset unit. This handles clean-database rebuilds where old proxy auth tokens and proxy DReps remain on-chain but the app has no `Proxy` rows. It cannot recover a proxy if the auth token is no longer discoverable at the current CI wallet address.

When preflight passes, each legacy/SDK lifecycle creates its own proxy, finalizes the confirmed setup, exercises proxy spend, proxy DRep register/deregister, optional proxy voting when active governance proposals exist, then runs safe cleanup and asserts the proxy no longer appears in `GET /api/v1/proxies`. Proxy actions always use bot payment-address collateral that is distinct from selected wallet spend inputs; DRep registration selects an auth-token input plus additional wallet inputs when needed to meet the registration budget. The proposer/collateral owner is signer index 0 (`CI_MNEMONIC_1`), and signer index 1 (`CI_MNEMONIC_2`) broadcasts for the default threshold-2 proxy actions. After each broadcasted proxy action, the route-chain waits for the selected wallet inputs to disappear from fresh `freeUtxos` before proposing the next action. Cleanup may require two submitted transactions: a sweep transaction that empties the proxy address while preserving an auth token, followed by a burn transaction and cleanup finalization. If the initial cleanup call already returns a burn transaction, the optional burn proposal is skipped after that transaction is signed. Because this scenario runs on every PR, the default CI legacy and SDK wallets must stay funded; one-UTxO shape problems are repaired by the self-split step, while true budget failures still fail the route-chain rather than skipping proxy lifecycle coverage.

Runtime expectation: `scenario.proxy-smoke` is the quick, non-mutating proxy subset. `scenario.proxy-full-lifecycle` is a real-chain scenario with multiple broadcasts per eligible wallet and can dominate default PR smoke duration during slow preprod/Blockfrost periods. The GitHub Actions job timeout is intentionally higher than the nominal happy path to leave room for confirmation polling.

For each tested wallet type, the `nativeScript` step stores decoded script payloads in step artifacts (`artifacts.nativeScripts`) and the list of script entry types (`artifacts.scriptTypes`) inside `ci-route-chain-report.md`, so script structure is visible during CI triage.

Signing is expected to be on, and broadcast is expected to be on, for normal CI route-chain runs.

### Ring transfer

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

### Create-wallet scenario (`scenario.create-wallet`)

Runs after the early discovery and ADA route-health checks, before request-heavy default-bot scenarios. This keeps the app's rate-limit behavior intact while avoiding earlier smoke checks consuming the shared bot rate-limit budget before the positive wallet creation assertion. Requires `multisig:create` scope on the CI bot (provisioned by default).

**Step 1** — calls `POST /api/v1/createWallet` with the CI signer addresses and the `CI_NUM_REQUIRED_SIGNERS` threshold. Asserts the response is 201 with a `walletId` and `address`.

**Step 2** — calls `GET /api/v1/walletIds` for the bot and asserts the new `walletId` is present. This confirms the bot's cosigner access was set correctly during wallet creation.

**Step 3 (cleanup, non-critical)** — deletes the test wallet directly via Prisma (`WalletBotAccess` rows first, then the `Wallet` row). Marked non-critical so a cleanup failure does not fail the scenario. If cleanup is skipped (e.g. step 1 failed), no orphan wallet is left behind.

### DRep certificate scenarios (`scenario.drep-certificates`)

Runs when both `legacy` and `sdk` wallets are in context. Requires `CI_DREP_ANCHOR_URL`.

For each wallet type the scenario runs a pre-hygiene step followed by two sequential phases — register then retire — leaving the wallet in its pre-test DRep state:

**Pre-hygiene step** — checks on-chain DRep state via `GET /api/v1/drepInfo`. If the DRep is already registered (e.g. from a previous incomplete run), it proposes a `retire` tx, signs with both signers, and waits for on-chain confirmation. If the broadcast is rejected with `DRepNotRegistered` or similar errors, the credential is treated as already clean (stale Blockfrost cache false-positive) and the step succeeds silently.

**Main test phases:**

1. Fetch free UTxOs from the wallet, call `POST /api/v1/botDRepCertificate` with `action: "register"`, `anchorUrl`, and `anchorJson` (the parsed JSON from `CI_DREP_ANCHOR_JSON`). The API computes the anchor data hash server-side from `anchorJson` — no outbound fetch anywhere.
2. Assert the transaction appears in pending.
3. Signer 1 (`CI_MNEMONIC_2`, index 1) adds a payment-key witness, no broadcast.
4. Signer 2 (`CI_MNEMONIC_3`, index 2) adds a payment-key witness and broadcasts.
5. Assert the transaction is cleared from pending.
6. Poll `freeUtxos?fresh=true` until the spent inputs are no longer unspent on-chain (confirms block inclusion before the next phase). Up to 30 retries × 8 s = 4 minutes.
7. Repeat steps 1–6 with `action: "retire"`.

**Why payment-key witnesses are sufficient for DRep cert:**

- **Legacy wallet:** the DRep credential script is the same as the payment script (no separate DRep keys), so the same payment vkeys satisfy both the spending inputs and the DRep certificate.
- **SDK wallet:** the CI bootstrap sets `signersDRepKeys = paymentKeyHashes`, so the DRep certificate script is also built from payment key hashes. Payment vkeys satisfy both scripts.

### Stake certificate scenarios (`scenario.stake-certificates`)

Runs when the `sdk` wallet is in context. Does not require `CI_DREP_ANCHOR_URL`. **`CI_STAKE_POOL_ID_HEX` is required** — it is passed as `poolId` in the `register_and_delegate` body.

The scenario runs three phases:

**Pre-hygiene step** — before the main test, checks on-chain state via `GET /api/v1/stakeAccountInfo`. If the stake credential is already registered (e.g. from a previous incomplete run), it proposes a `deregister` tx, signs with both signers, and waits for on-chain confirmation. If the broadcast is rejected with `StakeKeyNotRegisteredDELEG` or similar errors, the credential is treated as already clean (stale Blockfrost cache false-positive) and the step succeeds silently.

**Main test: `register_and_delegate`** — uses `register_and_delegate` rather than bare `register` because production `stakingCertificates.ts` includes `.certificateScript()` on the register cert. In Conway era a bare register cert with a script witness causes `ExtraneousScriptWitnessesUTXOW`; `register_and_delegate` avoids this because the delegate cert legitimately requires the same staking script. Each phase follows 6 steps (propose → pending → sign1 → sign2+broadcast → cleared → on-chain confirmation poll).

**Main test: `deregister`** — restores the wallet to its pre-test staking state. Same 6-step flow.

Each signing step uses **`runStakeCertSigningFlow`** (`scenarios/flows/certificateSigningFlow.ts`) instead of the standard `runSigningFlow`, because the staking certificate script uses **stake key hashes** (role-2 keys) rather than payment key hashes:

1. `MeshWallet.signTx(txCbor, true)` produces both a payment vkey witness and a stake vkey witness.
2. The flow extracts the payment vkey (matched by `resolvePaymentKeyHash(signerAddress)`) and the stake vkey (matched by `resolveStakeKeyHash(ctx.signerStakeAddresses[signerIndex])`). If the stake vkey cannot be found by key-hash search, the flow falls back to BIP32 derivation at path `m/1852'/1815'/0'/2/0` and signs the tx hash manually.
3. Both are submitted in a **single** `POST /api/v1/signTransaction` call via the optional `stakeKey` / `stakeSignature` body fields — this avoids hitting the "address already signed" guard that would block a second call from the same signer.

`signTransaction` validates the stake witness by checking that its key hash is present in `wallet.signersStakeKeys` (resolved to key hashes). The stake witness is merged into the transaction CBOR alongside the payment witness before the broadcast threshold check runs.

## Environment and secrets

Primary variables (in workflow/compose):

- `CI_JWT_SECRET`
- `CI_MNEMONIC_1`, `CI_MNEMONIC_2`, `CI_MNEMONIC_3`
- `CI_BLOCKFROST_PREPROD_API_KEY`
- `CI_NETWORK_ID`
- `CI_WALLET_TYPES`
- `CI_NUM_REQUIRED_SIGNERS` (default `2`): minimum signature threshold written into each created wallet's native script. Passed as `requiredSigners` during bootstrap. Also used by the `nativeScript` step to assert that the decoded `atLeast` script's `required` count matches, and by `scenario.create-wallet` as the `numRequiredSigners` parameter.
- `CI_SIGN_WALLET_TYPE` (default `legacy`): which wallet type is used when `runSigningFlow` resolves a wallet for signing in ring-transfer steps. Overridden per leg in transfer scenarios.
- `SIGN_BROADCAST`
- `CI_ROUTE_SCENARIOS` (optional scenario id filter)
- `CI_TRANSFER_LOVELACE` (optional transfer amount)
- `CI_DREP_ANCHOR_URL` (required by the default run for `scenario.drep-certificates` and `scenario.proxy-full-lifecycle`): the URL string stored in the on-chain anchor — passed as-is to the API, never fetched.
- `CI_DREP_ANCHOR_JSON` (required by the default run for `scenario.drep-certificates`): the raw JSON content of the CIP-119 DRep metadata document. Parsed and sent as `anchorJson`; the API computes the anchor data hash server-side — no outbound fetch anywhere. Both vars are forwarded into the `ci-runner` container via `docker-compose.ci.yml`.
- `CI_STAKE_POOL_ID_HEX` (**required** for `scenario.stake-certificates`): hex stake pool id stored in bootstrap context and used as `poolId` in the `register_and_delegate` certificate body.
- `CI_HTTP_RETRIES` (default `6`), `CI_HTTP_RETRY_DELAY_MS` (default `1000`), `CI_HTTP_MAX_RETRY_DELAY_MS` (default `30000`): route-chain API retry controls for transient responses (`429`, `418`, and selected `5xx`). Defaults are long enough to ride out the app's 60-second in-process rate-limit window without changing app behavior.

Validation notes:

- Route-chain transfer scenarios are preprod-only; `CI_NETWORK_ID` must be `0`.
- Signer/bot/wallet addresses used in context must all be testnet-form (`addr_test` / `stake_test`).
- `CI_WALLET_TYPES` must contain only `legacy`, `hierarchical`, `sdk`; invalid values fail fast.
- The default full route-chain (including ring transfer scenario) requires all three wallet types (`legacy`, `hierarchical`, `sdk`) to be present.
- `CI_ROUTE_SCENARIOS` values must exist in `scenarios/manifest.ts`; unknown ids fail fast.
- `CI_MNEMONIC_1`, `CI_MNEMONIC_2`, and `CI_MNEMONIC_3` must derive signer addresses from bootstrap context for multi-signer route-chain signing. Signer indexes are zero-based relative to `wallet.signerAddresses`.
- `CI_STAKE_POOL_ID_HEX` must be set when running `scenario.stake-certificates`; the scenario throws at proposal time if `ctx.stakePoolIdHex` is absent.
- Proxy full lifecycle runs by default for legacy and SDK wallets. Before new proxy setup, route-chain first recovers any chain-discoverable proxy rows, adopts historical rows for the same deterministic wallet script, and runs hygiene so stale proxy DReps/auth tokens are cleaned centrally. Those CI wallets must have enough selectable multisig-wallet ADA for initial proxy funding, the planned proxy spend, DRep registration, and fee headroom, plus an ADA-only collateral UTxO at `bot.paymentAddress`. If total ADA is sufficient but the UTxO shape is not, route-chain self-splits it before proxy preflight by creating a 6 ADA collateral output at `bot.paymentAddress`. The proxy collateral is selected from `bot.paymentAddress`, which is signer index 0 in the bootstrap wallet context.
- Source multisig wallet script addresses must be funded on preprod for each ring leg (`legacy -> hierarchical -> sdk -> legacy`).
- `CI_JWT_SECRET` must remain the same between bootstrap and route-chain, because bot auth secrets are deterministically derived from it.
- CI bot keys are provisioned with scopes: `multisig:create`, `multisig:read`, `multisig:sign`, `governance:read`, `ballot:write`.

## Bootstrap context schema

`cli/bootstrap.ts` writes **`schemaVersion`: `3`** only; route-chain rejects any other version. There are no persisted runtime secrets.

- `wallets[]`: `{ type, walletId, walletAddress, signerAddresses }` (no seeded `transactionId`)
- `bots[]`: `{ id, paymentAddress, botKeyId, botId }`
- `defaultBotId`: primary bot used for discovery/freeUtxos assertions
- `signerStakeAddresses[]`: stake (`stake_test` / `stake1`) addresses aligned with `signerAddresses` (derived from each signer’s payment address).
- `sdkStakeAddress` (optional): multisig reward address for the CI SDK wallet (same derivation as `MultisigWallet.getStakeAddress()`); omitted if `CI_WALLET_TYPES` did not include `sdk`.
- `stakePoolIdHex` (optional): copied from `CI_STAKE_POOL_ID_HEX` when set.

### Native scripts and wallet types

Cardano “native scripts” here are `sig` / `all` / `any` / `atLeast` trees ([`MultisigWallet`](src/utils/multisigSDK.ts)).

- **Staking (SDK multisig):** UTxOs are witnessed with the **payment** script; stake registration / delegation / deregistration certificates use **`certificateScript`** with the **staking** script (`buildScript(2)` / role `2` keys). Bootstrap always attaches role-2 stake keys for the SDK wallet. Because the staking script uses **stake key hashes** (distinct from payment key hashes), `signTransaction` accepts an optional `stakeKey` / `stakeSignature` pair validated against `wallet.signersStakeKeys`.
- **DRep registration / voting:** **Legacy** wallets use a **single** script (payment-only) for both spending and DRep identity. **SDK** wallets with DRep keys use the **payment** script for inputs and a **DRep** script (`buildScript(3)`) for DRep certificates. In the CI bootstrap `signersDRepKeys` is set to the payment key hashes, so standard payment-key witnesses satisfy the DRep certificate script without any additional witness type.

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

## Report format

`ci-route-chain-report.md` is a Markdown file structured for human triage. It contains:

1. **Run header** — overall status, timestamp, duration, network, wallet types.
2. **Wallet balances table** — UTxO count and ADA balance per wallet type at run end. Native asset counts noted when present.
3. **Scenario summary table** — pass/fail, step pass rate, and duration per scenario.
4. **Step detail sections** — one subsection per scenario with a step table (step ID, duration, result message). Failed steps include their error and artifacts as code blocks. Passing step artifacts are intentionally omitted from Markdown, so use the step message and rerun targeted scenarios when detailed recovery diagnostics are needed.

Balance source: direct on-chain UTxO lookup per wallet address from bootstrap context (includes UTxOs referenced by pending transactions). Lovelace values shown as ADA (2 d.p.). If balance collection fails, a warning line replaces the table.

## Proxy Full Lifecycle UTxO Shaping

`scenario.proxy-full-lifecycle` needs a wallet script UTxO for proxy setup/spend and a separate key-address collateral UTxO at `bot.paymentAddress` for each eligible wallet type (`legacy`, `sdk`). When a funded wallet has enough ADA but lacks the required wallet/key UTxO shape, the route-chain now performs an idempotent self-split before the proxy preflight:

- If fresh `freeUtxos` plus fresh `bot.paymentAddress` UTxOs already satisfy the lifecycle budget and key collateral shape, the shaping step is a no-op.
- If wallet ADA is sufficient but the shape is not, the step submits a real preprod self-split through `/api/v1/addTransaction`, creating a 6 ADA collateral output at `bot.paymentAddress` and returning the rest as change to the wallet script address. The split requires the 536 ADA lifecycle budget plus the 6 ADA collateral output and a 2 ADA self-split fee buffer.
- The self-split is signed by signer 1 and signer 2 using the existing `CI_MNEMONIC_2` / `CI_MNEMONIC_3` route-chain signing path, then waits for the original inputs to disappear from fresh `freeUtxos`.
- Server-built proxy transactions are persisted with no initial signed addresses. Because key-address collateral lives at `bot.paymentAddress`, proxy setup and action transactions first add signer index 0 (`CI_MNEMONIC_1`) as a real collateral witness, then signer index 1 (`CI_MNEMONIC_2`) broadcasts for the default threshold-2 wallet.
- Manual funding is still required when the wallet does not have enough total ADA for the proxy lifecycle budget plus the 6 ADA collateral output and fee buffer.

Because the self-split is an on-chain transaction, it can add one confirmation wait per wallet type, but only when the current UTxO shape needs repair.

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
$env:CI_DREP_ANCHOR_URL="https://..."   # required for the default full flow; stored as on-chain anchor URL, never fetched
$env:CI_STAKE_POOL_ID_HEX="..."         # required for the default full flow (scenario.stake-certificates)
```

`CI_DREP_ANCHOR_JSON` contains the full CIP-119 JSON document and must be set separately using a PowerShell here-string so the double quotes are preserved:

```powershell
$env:CI_DREP_ANCHOR_JSON = @'
{
    "@context": {
        "CIP100": "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
        "CIP119": "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0119/README.md#",
        ...
    },
    "hashAlgorithm": "blake2b-256",
    "body": { ... }
}
'@
```

In GitHub Actions, store the full JSON as a repository secret — the runner injects it verbatim, no quoting required.

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

Optional: confirm wallets are funded on-chain before running route-chain (uses `CI_CONTEXT_PATH` and `CI_BLOCKFROST_PREPROD_API_KEY`; same total-balance semantics as `walletBalanceSummary` in the route-chain report). Flags: `--json` (machine-readable summary only), `--strict` (exit with status 1 if balance collection fails).

```powershell
docker compose -f docker-compose.ci.yml run --rm `
  -e CI_CONTEXT_PATH=/artifacts/ci-wallet-context.json `
  ci-runner npx --yes tsx scripts/ci/cli/wallet-status.ts
```

Run route-chain smoke scenarios:

```powershell
docker compose -f docker-compose.ci.yml run --rm `
  -e CI_CONTEXT_PATH=/artifacts/ci-wallet-context.json `
  -e CI_ROUTE_CHAIN_REPORT_PATH=/artifacts/ci-route-chain-report.md `
  ci-runner npx --yes tsx scripts/ci/cli/route-chain.ts

```

View generated report on host:

```powershell
Get-Content ".\ci-artifacts\ci-route-chain-report.md"
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
export CI_DREP_ANCHOR_URL="https://..."   # required for the default full flow; stored as on-chain anchor URL, never fetched
export CI_STAKE_POOL_ID_HEX="..."        # required for the default full flow (scenario.stake-certificates)
```

`CI_DREP_ANCHOR_JSON` contains the full CIP-119 JSON document and must be set separately using a heredoc so the double quotes are preserved:

```bash
export CI_DREP_ANCHOR_JSON=$(cat <<'EOF'
{
    "@context": {
        "CIP100": "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
        "CIP119": "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0119/README.md#",
        ...
    },
    "hashAlgorithm": "blake2b-256",
    "body": { ... }
}
EOF
)
```

In GitHub Actions, store the full JSON as a repository secret — the runner injects it verbatim, no quoting required.

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

Optional: confirm wallets are funded on-chain before running route-chain (uses `CI_CONTEXT_PATH` and `CI_BLOCKFROST_PREPROD_API_KEY`; same total-balance semantics as `walletBalanceSummary` in the route-chain report). Flags: `--json` (machine-readable summary only), `--strict` (exit with status 1 if balance collection fails).

```bash
docker compose -f docker-compose.ci.yml run --rm \
  -e CI_CONTEXT_PATH=/artifacts/ci-wallet-context.json \
  ci-runner npx --yes tsx scripts/ci/cli/wallet-status.ts
```

Run route-chain smoke scenarios:

```bash
docker compose -f docker-compose.ci.yml run --rm \
  -e CI_CONTEXT_PATH=/artifacts/ci-wallet-context.json \
  -e CI_ROUTE_CHAIN_REPORT_PATH=/artifacts/ci-route-chain-report.md \
  ci-runner npx --yes tsx scripts/ci/cli/route-chain.ts
```

View generated report on host:

```bash
cat ./ci-artifacts/ci-route-chain-report.md
```
