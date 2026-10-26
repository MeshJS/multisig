# Plutus transaction controls: Phase 0 regression baseline

Recorded: 2026-10-26 (Africa/Johannesburg)  
Runtime under review: `feat/plutus-transaction-controls`, `4a04ded1`  
Scope: [gap remediation plan, Phase 0](plutus-transaction-controls-gap-plan.md#phase-0-capture-reproducible-regression-cases)

This phase adds executable reproductions and records the support/evidence boundary.
It does not fix production behavior or add new advertised capabilities. All
references, keys and signatures in the added fixtures are synthetic; no transaction
was submitted to a chain during this phase.

**Phase 1 update (2026-10-26):** G1 is now fixed and its expected-failure marker
has been removed. The inventory and counts below preserve the Phase 0 baseline.
The current remaining expected failures are three Jest cases (G2/G4) and five
browser cases (G3/G4). See the [Phase 1 record](plutus-transaction-controls-gap-plan.md#phase-1-preserve-multisig-participation-when-scripts-supply-all-value)
for implementation and co-signing evidence.

**Phase 2 update (2026-10-26):** G2 is now fixed through the shared CBOR/chain
reconstruction boundary. Its importer regression is an ordinary passing test,
including edit/rebuild/replacement. The current remaining expected failures are
two Jest cases (G4) and five browser cases (G3/G4). The historical Phase 0 counts
below are unchanged; see the [Phase 2 record](plutus-transaction-controls-gap-plan.md#phase-2-restore-safe-editing-of-imported-pending-transactions)
for the new boundary and validation evidence.

## Regression inventory

| Gap | Production boundary exercised                                                                   | Reproduction and passing control                                                                                                                                                                                                                                                                                     | Expected-failure cases |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| G1  | `buildDraftTx`, funding selection, witness merging and payment-witness verification             | `txDraftBuild.test.ts` builds a 2-of-2 source with 20 ADA in script inputs and an 8 ADA payment. Automatic selection gives the second member no requested key; exact manual selection of a wallet input gives that same member a valid signing role. The fixture signs only keys requested by CBOR.                  | 1 Jest                 |
| G2  | Actual `transactionRouter.importTransaction` through its tRPC caller, then editor compatibility | `txDraftImportedPending.test.ts` imports real signed CBOR with synthetic chain/database boundaries. Normal setup verifies endpoint success, the unchanged signed bytes and decoded outputs; the endpoint's untyped input JSON fails editor compatibility.                                                            | 1 Jest                 |
| G3  | Real CBOR assessment and production pending hook/dialog in the existing browser harness         | `pendingRiskReview.test.ts` verifies independent datum-only and redeemer-only changes alter the signed body while preserving recipients and amounts. `review.spec.ts` loads and replaces a pending contract fixture, then checks that its exact datum, redeemer and recorded budget are visible.                     | 3 browser              |
| G4  | `reviewBuiltTransaction` with the real chain resolver; production builder review dialog         | `txRiskReview.test.ts` changes the provider after confirmation and proves it now yields an incomplete review. The action still runs. Browser cases reproduce spending an input while the dialog is open for both signing and export. Existing pending-review tests retain their after-confirmation refusal coverage. | 2 Jest + 2 browser     |

The existing test named “accepts the importTransaction shape” actually supplied a
typed `PubKey` input. It is renamed to describe its typed Mesh input shape; the new
endpoint test supplies the genuine importer output without duplicating its JSON
conversion logic.

### How expected failures work

The four Jest desired-behavior assertions use `knownPlutusGap`, which delegates to
Jest's `test.failing`. The five browser assertions use Playwright's `test.fail`.
These tests execute; they are not skipped. An unexpected pass fails the run, so
each corresponding remediation phase must remove the expected-failure marker and
retain an ordinary regression assertion.

Setup, decoding, provider-state validation and browser mounting run outside the
expected-failure boundary. A broken fixture or unavailable browser must fail the
run normally rather than count as reproducing a gap. The G1 manual-input control
also verifies the restrictive signer can produce a valid witness when requested.

Set `PLUTUS_GAP_ASSERT_DESIRED=1` to disable all these expected-failure markers and
inspect the underlying assertions. The diagnostic commands below intentionally
exit nonzero while the gaps remain:

```powershell
$env:PLUTUS_GAP_ASSERT_DESIRED = '1'
npm.cmd test -- --runInBand src/__tests__/txDraftBuild.test.ts src/__tests__/txDraftImportedPending.test.ts src/__tests__/txRiskReview.test.ts --testNamePattern='G[124]:'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npx.cmd playwright test -c e2e/risk-components.config.ts --grep 'G[34]:'
Remove-Item Env:PLUTUS_GAP_ASSERT_DESIRED
```

Use an installed compatible Chromium executable if the shown Chrome path differs
on another machine. The override is already supported by the browser configuration.

## Reconstruction boundary for Phase 2

The target is supported ordinary ADA/token transfers first, plus preservation of
the already-supported editor shapes. Compatibility must ultimately depend on the
original CBOR, authoritative wallet identity and necessary resolved input facts.
Missing `type` is not permission to guess whether an input is key- or script-owned.

| Shape                                                                                                                                                                                                      | Required treatment                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Legacy imported ordinary native-wallet transfer with untyped input JSON                                                                                                                                    | Recover from CBOR and resolved input ownership; restore editing. Retain original bytes separately.                 |
| Typed ordinary transfers and existing supported native staking/DRep-vote shapes                                                                                                                            | Preserve existing compatibility and identity checks; avoid widening supported certificate/vote types.              |
| Supplied V1 script with supplied hash-matching datum                                                                                                                                                       | Preserve input reference, script/version, datum and redeemer; re-evaluate on rebuild.                              |
| Supplied V2/V3 script with inline or supplied hash-matching datum                                                                                                                                          | Preserve the same associations and supported single collateral input.                                              |
| Valid explicit required signer hashes                                                                                                                                                                      | Retain every requirement, including previous collateral-owner requirements already encoded in an imported body.    |
| Outputs with validated inline datum                                                                                                                                                                        | Preserve per-output identity and data, including two outputs at one address.                                       |
| Missing or unverifiable output provenance                                                                                                                                                                  | Retain every output and the ambiguous-change warning; address equality alone cannot authorize deleting an output.  |
| Unsupported output datum hash/reference script, reference inputs/scripts, withdrawals, minting, proposals, unsupported certificates/votes, validity windows, script metadata or collateral-return controls | Refuse editing with a specific reason. Do not silently omit fields that were encoded in CBOR but absent from JSON. |
| Conflicting input shapes, duplicate/overlapping references, malformed data/signers, missing mandatory chain facts                                                                                          | Refuse reconstruction and offer correction/retry.                                                                  |

Editor compatibility and read-only review are separate: an unsupported editable
shape must not prevent a co-signer from inspecting the original transaction.
Rebuilding replaces the body and discards previous signatures; loaded budgets do
not substitute for fresh evaluation.

## Language/datum evidence inventory

This table describes evidence found in the repository and rerun in Phase 0. It
does not mark Phase 5 complete. Historical results come from the
[2026-10-23 release record](transaction-script-risk-release.md).

| Combination                       | Serialization/reconstruction with mocked evaluation                | Real offline script execution                                         | Full-app browser with mocked boundaries                                                                               | Confirmed preprod                                       |
| --------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| V1 + supplied hash-matching datum | Existing `txDraftBuild.test.ts` round-trip and datum-witness cases | No evidence recorded                                                  | No dedicated language/datum case recorded                                                                             | No evidence recorded                                    |
| V2 + inline datum                 | Existing round-trip/build cases                                    | Manual fixture rerun in Phase 0; redeemers `01` and `02` both execute | Existing V2 risk/preprod flow has mocked-boundary coverage                                                            | Passed historically on 2026-10-23; not rerun in Phase 0 |
| V2 + supplied hash-matching datum | Existing round-trip and datum-witness cases                        | No evidence recorded                                                  | No dedicated language/datum case recorded                                                                             | No evidence recorded                                    |
| V3 + inline datum                 | Existing round-trip/build cases                                    | No evidence recorded                                                  | `builder-script-inputs.spec.ts` contains a V3 inline fixture with mocked evaluation; historical full-app run recorded | No evidence recorded                                    |
| V3 + supplied hash-matching datum | Existing round-trip and datum-witness cases                        | No evidence recorded                                                  | No dedicated language/datum case recorded                                                                             | No evidence recorded                                    |

Important limits of these fixtures:

- The parameterized unit build fixture uses the same script bytes under different
  language labels and a mocked evaluator. It tests serialization, associations and
  round trips; it does not prove that those bytes execute under V1 or V3.
- `contractReviewTransaction` is a serialized synthetic V2 review fixture with a
  real script-data hash and recorded synthetic budgets. It is not evaluated and
  must not be counted as additional execution or chain evidence.
- The isolated browser harness mounts production review components and hooks, but
  stubs codec/provider results in the browser. Node-side fixture tests use the real
  codecs/resolver. Neither is an authenticated live wallet acceptance test.
- V1 with inline data remains explicitly unsupported. Hash-datum funding helpers
  for Phase 5 do not imply a new user-facing hash-datum output editor.
- Phase 5 must obtain actual language-compatible validators for all five rows and
  run the final integrated application. The historical V2 result cannot close the
  other four rows or certify later runtime fixes.

## Check results and known baseline failures

Before test additions, the five affected existing Jest suites passed **152 tests**
and `npm run typecheck -- --incremental false` passed.

The Phase 0 verification results are recorded here after execution:

- Full Jest CJS/ESM run: **1,958 cases accepted** (1,859 CJS + 99 ESM),
  including the 4 executed expected failures. There are **1,954 ordinary passes**;
  the existing 1 skipped suite and 2 skipped tests remain. Expected failures must
  not be interpreted as implemented behavior.
- Final `npm run typecheck -- --incremental false`: passed.
- Desired-behavior diagnostic, Jest: exactly **4 expected assertions failed**
  (G1, G2, G4 spent input, G4 provider failure); both normal controls passed.
- Desired-behavior diagnostic, browser: exactly **5 expected assertions failed**
  (G3 datum/redeemer/budget visibility; G4 signing/export after a spent input).
  There were no setup or browser-launch failures in this diagnostic run.
- Isolated browser, ordinary expected-failure mode: **20 cases accepted**,
  comprising 15 ordinary passes and 5 reproduced expected failures.
- Real offline V2 fixture: passed. Both redeemers used **1,100 memory** and
  **160,100 steps**. No chain transaction was created.
- `npm run lint`: existing failure; Next 16 interprets `next lint` as the missing
  `lint` project directory. It is not a passing lint check.
- The first browser attempt could not find Playwright's bundled Chromium. Running
  with the existing `PLAYWRIGHT_CHROMIUM_EXECUTABLE` override and installed Chrome
  succeeded; no browser installation or application configuration change was needed.

Normal verification commands (leave `PLUTUS_GAP_ASSERT_DESIRED` unset):

```powershell
npm.cmd test -- --runInBand
npm.cmd run typecheck -- --incremental false
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npx.cmd playwright test -c e2e/risk-components.config.ts
node scripts/plutus-manual-fixture.mjs
```

Full-app Docker tests, live preprod acceptance and production deployment are not
part of this Phase 0 execution. The existing human accessibility and deployment
gates remain open in the release record.
