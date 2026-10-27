# Script-risk guardrails: phase 6 evidence and release gates

Feature: [Plutus Transaction Controls](../vault/features/Plutus%20Transaction%20Controls.md).
Scope: [phase 6 plan](transaction-script-risk-guardrails-plan.md#phase-6--regression-coverage-documentation-and-release).
Validation date: 2026-10-23 (Africa/Johannesburg).

This record distinguishes automated regression results, full-app behavior with
mocked boundaries, and actual preprod confirmation. None substitutes for another.
Controlled preprod acceptance passed. Promotion remains pending the human
accessibility spot check and deployment-specific rollout gates below.

The results below preserve the 2026-10-23 V2-inline exercise. The subsequent
[2026-10-27 language/datum matrix](plutus-acceptance-matrix.md) tracks Phase 5 of
the gap-remediation plan on the build containing Phases 1-4. Its offline,
full-application and preprod results are recorded separately for all five cases.

## Acceptance matrix and reproducible checks

| Scenario                                                                     | Evidence source                                                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Funding-only known recipient in multisig, connected and other-address modes  | `transaction-risk-guardrails.spec.ts`; `txRiskReview.test.ts`                                                       |
| Hash detection across mainnet/testnet and address variants                   | `txRisk.test.ts`; mobile mainnet fixtures in `risk-components/review.spec.ts` (synthetic only)                      |
| Key payment with datum/script stake; own native change; unknown scripts      | `txRisk.test.ts`, `txRiskReview.test.ts`, `pendingRiskReview.test.ts`                                               |
| Proxy invariants and refusal before wallet prompt                            | `pendingTransactionCard.test.ts`, `useTransactionReview.test.ts`, existing proxy suites                             |
| Recovery of anyone-can-spend input                                           | `txRisk.test.ts`, `txDraftScriptInputs.test.ts`, preprod guide                                                      |
| Duplicate outputs, minimum-ADA adjustment, exact tokens                      | `txRiskReview.test.ts`, `txRisk.test.ts`, `txReviewRisk.test.ts`                                                    |
| Address/amount/datum/redeemer/collateral/source/account/network edits        | Store-backed `txRiskReview.test.ts`; `risk-components/review.spec.ts`                                               |
| Cancellation, replacement, one-approval/final signer, re-signing             | `pendingTransactionCard.test.ts`, `useTransactionReview.test.ts`, pending guard/browser tests                       |
| Imported CBOR, misleading/missing JSON, unsupported editor features          | `transaction-risk-guardrails.spec.ts`, `pendingRiskReview.test.ts`, `txReviewRisk.test.ts`                          |
| Changed CBOR with unchanged pending row/hash/signers                         | `pendingTransactionsFreshness.test.ts`; hook generation tests in browser suite                                      |
| Spent collateral, owner witness, recorded return, provider/evaluator failure | `txDraftCollateral.test.ts`, `txDraftPlutus.test.ts`, `pendingRiskReview.test.ts`, `pendingTransactionCard.test.ts` |
| Mobile, keyboard, accessible dialog names/checkboxes, focus trap/return      | `risk-components/review.spec.ts`; this checks browser accessibility semantics, not a human screen-reader session    |
| MCP text/HTML/PNG parity and unsigned confirmation                           | `txReviewRisk.test.ts`, `txReviewRenderPng.test.ts`, `risk-components/mcp-risk.spec.ts`                             |

Run from the repository root (use `npm.cmd` / `npx.cmd` under Windows PowerShell
if local execution policy blocks the `.ps1` wrappers):

```powershell
npm test -- --runInBand
npm run typecheck
npx playwright test -c e2e/risk-components.config.ts
node scripts/plutus-manual-fixture.mjs
npm run lint
git diff --check
```

Full-app tests use the existing [Docker/authenticated wallet fixtures](../e2e/RUNNING_LOCALLY.md).
Rebuild the app from this checkout, bootstrap, then select only these specs:

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright --profile playwright run --rm --no-deps playwright-runner npx playwright test -c e2e/playwright.config.ts e2e/tests/transaction-risk-guardrails.spec.ts e2e/tests/builder-output-datum.spec.ts e2e/tests/builder-script-inputs.spec.ts e2e/tests/builder-collateral.spec.ts --workers=1
```

These full-app guardrail tests use real serialization and application code with
synthetic chain reads and a rejecting CIP-30 signing boundary. They assert no
signing before acknowledgment and no submission. They do not provide chain
acceptance. The existing unfiltered E2E suite includes real ring transfers.

## Execution results

Results are recorded here after validation; local logs are in ignored
`ci-artifacts/phase6-*` and browser artifacts in `ci-artifacts/risk-components/`.

- Offline fixture: passed on 2026-10-23. Redeemers `01` and `02` each consumed
  1,100 memory units and 160,100 steps with the installed offline evaluator.
  Synthetic references only; no wallet signature or broadcast.
- Full Jest regression: **1,948 passed** (1,849 CJS + 99 ESM), with one existing
  skipped CJS suite and two skipped tests. Includes real PNG rendering and the
  new store/cache regressions. Log: `phase6-jest-final.log`.
- Isolated Chromium: **15 passed**, including builder/pending focus restoration,
  keyboard/mobile mainnet fixtures, exact tokens and the production MCP inline
  view. Log: `phase6-browser-final.log`.
- `npm run typecheck`, changed-file Prettier checks and `git diff --check`: passed.
- `npm run lint`: **baseline failure**; installed Next 16 treats `next lint` as
  the nonexistent `lint` project directory. This was not counted as a passing check.
- Production Docker build: passed, with existing async-WASM target warnings.
  Runtime source is checkout `2621d33aef10bddac2fefbbc96458d57cd1864ec` plus this
  phase 6 patch. Final local image ID:
  `sha256:dc53401e70f8c3f145f0cb29e0e812ce8ea059d302acfba13a9da8758525b746`.
- Environment recovery: the first app exited 137 during the concurrent build;
  bootstrap also encountered a duplicate-bot conflict in the existing database.
  The final image was tested in isolated Compose project `multisig-phase6`, with
  its own new database and the existing disposable preprod identities. Bootstrap
  passed. Temporary validation services were stopped afterward; volumes and
  reports were retained.
- Full-app Chromium: **8 passed** against the final image in 1.9 minutes. Covers
  all builder sources, unsigned export, independent pending co-signers, datum
  identity, collateral, script evaluation/export and pending reconstruction.
  Log: `phase6-full-app-final.log`. Boundary mocks prevent real signing/submission.
  The initial run exposed outdated DOM-order/selector and insecure-HTTP clipboard
  assumptions in the tests; the corrected run passed all eight scenarios.
  After the CIP-30 fixture correction, all eight passed again: seven in
  `phase6-fixture-regression.log` and collateral in `phase6-collateral-regression.log`.
- Wallet-fixture regression: **2 passed** (`phase6-cip30-unit.log`). The CIP-30
  bridge now serializes UTxOs instead of returning Mesh objects; real-codec tests
  preserve output references, exact assets, inline datum and reference script.
- Controlled preprod: **passed**, completed at 2026-10-23 08:37:17 UTC. The
  resumed spending/replacement/co-signing run passed in 6.9 minutes
  (`phase6-preprod-live.log`, attachment `preprod-evidence.json` in
  `phase6-preprod-live-results`). Funding and its independent reviews passed in
  the initial run. Retries corrected the wallet fixture and allowed live
  hydration/evaluation time; all reused the original funding output.
- Independent chain read at 08:38:30 UTC (`phase6-chain-confirmation.json`):
  `valid_contract: true`; the recorded script output was consumed by the
  replacement, its fee was **191,405 lovelace**, and the **2 ADA collateral
  remained unspent**. Confirmation block:
  `aa65543ca62e660714a818e8233c950c21544709be9f90c4dc361546e186496a`.

The live runner is deliberately separate and opt-in. Ensure no other CI run is
using these preprod wallets, and inspect any previous `preprod-evidence.json`
before retrying. Its partial record identifies funded outputs even if a later
assertion fails; recover those before funding again.

For a run whose saved status is `funding-confirmed`, pass
`PREPROD_RISK_RESUME=/artifacts/<previous-results>/<test>/preprod-evidence.json`
and use a separate `PLAYWRIGHT_OUTPUT_DIR` to preserve that record. The runner
checks the wallet/network/script identity and skips funding. Later pending or
submitted stages require inspecting the existing proposal/chain state before
recovery; they must not be restarted as a fresh funding run.

```powershell
docker compose -f docker-compose.playwright.yml --env-file .env.playwright --profile playwright run --rm --no-deps -e RUN_PLUTUS_PREPROD_ACCEPTANCE=1 playwright-runner npx playwright test -c e2e/playwright.config.ts e2e/tests/transaction-risk-preprod.spec.ts --workers=1 --retries=0
```

The runner enforces testnet context and a preprod Blockfrost key and writes actual
hashes/confirmed outputs to its Playwright `preprod-evidence.json` attachment. It
funds 5 test ADA at the shared script plus a separate 2 test ADA collateral output,
then uses only that recorded script output. Never run it with valuable assets or
enable it globally in the ordinary E2E environment.

## Controlled preprod and release gates

Use only the disposable test ADA described in the [preprod guide](plutus-manual-preprod.md).
All testers share the script address; select only the tester's recorded output.

| Required evidence                                                   | Result                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Checkout commit/build and app URL                                   | Image above; isolated `http://webapp:3000`                                                                                  |
| Network and wallet approval threshold                               | Preprod; 2 of 3                                                                                                             |
| Funding transaction confirmed hash and own script output index      | `4a61bce8aeeb7bcf47700d395f1ccb40adb2342180f95cc82943e2e9d82e84bf#0` (5 ADA); collateral `#1` (2 ADA)                       |
| Funding warning before datum; cancel produces no wallet prompt      | Passed; cancellation recorded zero sign calls                                                                               |
| Spending proposal body hash with redeemer `01`                      | `323911ad7e0781a43995670d2bb11055e0c2b08b4237ccfae33bf9e315bc460f` (replaced while pending)                                 |
| Replacement body hash with redeemer `02`; old signatures discarded  | `f9832ddb34a44f8bef817d5a36fff4b2844a6de1d1f013cf46e96ab9cb3f693f`; new row with only the owner's fresh signature           |
| Both signers independently review; collateral owner witness present | Passed for funding and recovery; second signer prompted only after review; successful ledger validation                     |
| Confirmed spending hash and recovered amount                        | `f9832ddb34a44f8bef817d5a36fff4b2844a6de1d1f013cf46e96ab9cb3f693f`; 2 ADA to signer, change to multisig; collateral unspent |
| Human mobile/screen-reader spot check                               | Pending                                                                                                                     |
| Release target, build ID, smoke results and rollback build          | Pending                                                                                                                     |

Ship builder creation/export, pending co-signing and MCP parity in the **same
application release**. No database/protocol migration is needed. Before promoting,
record the exact build and complete the above exercise, then smoke-test builder,
pending and MCP from that build. If a mandatory review can be bypassed or values
disagree between surfaces, stop promotion and retain the previous release. Roll
back the application as one unit; do not disable only the pending signing guard.
Existing pending CBOR remains intact and receives independent review on retry.

The tested application bundles builder, pending and MCP coverage together.
No production target or rollback build was supplied, and no production deployment
was performed. Keep the feature in progress until those release gates are recorded.
