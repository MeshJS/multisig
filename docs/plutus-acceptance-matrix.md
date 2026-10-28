# Plutus language/datum acceptance matrix

Feature: [Plutus Transaction Controls](../vault/features/Plutus%20Transaction%20Controls.md).
Scope: [gap plan, Phase 5](plutus-transaction-controls-gap-plan.md#phase-5-complete-the-advertised-languagedatum-acceptance-matrix).
Validation date: 2026-10-27 (Africa/Johannesburg).

This record separates actual offline execution, application flows with mocked chain
boundaries, and confirmed preprod transactions. The 2026-10-23 V2 inline result
remains historical evidence in the [release record](transaction-script-risk-release.md).

## Fixtures and reproducibility

The checked-in [manifest](../e2e/fixtures/plutus-acceptance.json) records the exact
script bytes, hashes, addresses, source and provenance. Run:

```powershell
node scripts/plutus-acceptance-validators.mjs
node scripts/plutus-manual-fixture.mjs
```

The first command recompiles and compares the repository-authored V1/V3 validators
against the manifest. V1 uses three arguments and returns unit, with UPLC 1.0.0.
V3 uses one context argument and returns unit, with UPLC 1.1.0, following the
[ledger language calling conventions](https://plutus.cardano.intersectmbo.org/docs/working-with-scripts/ledger-language-version).
The V2 fixture remains the published Hydra validator. All are unrestricted test
validators: use only disposable preprod ADA and only recorded outputs from this run.

The second command executes both redeemers `01` and `02` in every supported case
with the installed real OfflineEvaluator. It verifies datum witnesses and hashes,
script identity, unsigned serialization and required keys. Synthetic UTxOs and
bundled cost models are used; this is not chain confirmation.

| Case                     | Offline execution (each redeemer)    | Full-app mocked boundaries | Final-build preprod |
| ------------------------ | ------------------------------------ | -------------------------- | ------------------- |
| V1 + supplied hash datum | Passed: 1,100 memory / 160,100 steps | Passed                     | Confirmed           |
| V2 + inline datum        | Passed: 1,100 memory / 160,100 steps | Passed                     | Confirmed           |
| V2 + supplied hash datum | Passed: 1,100 memory / 160,100 steps | Passed                     | Confirmed           |
| V3 + inline datum        | Passed: 500 memory / 64,100 steps    | Passed                     | Confirmed           |
| V3 + supplied hash datum | Passed: 500 memory / 64,100 steps    | Passed                     | Confirmed           |

V1 with inline data remains rejected. No user-facing hash-output editor was added.
`addFixtureFunding` in `e2e/helpers/plutusAcceptance.ts` creates hash-datum funding
outputs solely for acceptance fixtures.

## Confirmed preprod evidence

All five cases passed on 2026-10-27. The checked-in
[public evidence report](evidence/plutus-acceptance-2026-10-27.json) retains full
funding/collateral references, source and script identity, build/commit, 2-of-3
threshold, original/replacement hashes, datum/redeemer bytes, evaluated budgets,
verified witness key hashes, confirmation blocks and resulting outputs.

| Case        | Confirmed replacement transaction                                  |
| ----------- | ------------------------------------------------------------------ |
| V1 supplied | `8cc2ed21c24dce3489cb55cbf4940581ebc2ed2bfb1b6d34bd39def16ee09c23` |
| V2 inline   | `c00f09f6c4a615e31443c2ad84109ca67486e78c85263cbabefbd85d1e44ae08` |
| V2 supplied | `cca03d17a4c099a84e7fe7e4f33dabbdd5d781011bff6e38a6cfb76fdfa5d7fb` |
| V3 inline   | `71ba52355c425ac456bca2d3d0a980573f6aef30e809928fa2cb520186c73868` |
| V3 supplied | `262df52fa2f25d96ce58874dd1671426bfd50ab9b57d23b20303a2a050fa8836` |

Every replacement consumed its recorded script input and a native multisig input,
paid 2 ADA to the designated recipient, and left its separate 2 ADA collateral
unspent. Each case has five verified signing events: two funding signatures, one
original-proposal signature and two replacement signatures. Original and replacement
execution budgets match the offline values above. The independent read-only exporter
rechecked all five confirmed transactions, exact script inputs, funding datums,
recipient outputs and unspent collateral against Blockfrost before writing the report.

To reproduce that verification with the retained state and a preprod API key:

```powershell
node scripts/plutus-acceptance-evidence.mjs <state-directory> <report.json>
```

The exporter reads `CI_BLOCKFROST_PREPROD_API_KEY`; it never signs or submits.
Local raw recovery records remain in `ci-artifacts/phase5-matrix-state/`.
Phase 6 local integration is complete. The maintainer removed human accessibility
and deployment-specific checks from the completion scope on 2026-10-27; see the
[release record](transaction-script-risk-release.md) for the waived checks.

## Application checks

`builder-script-inputs.spec.ts` uses the manifest for all five build/export/reload
cases. Script value exceeds payments, yet the completed transaction must retain
native wallet inputs and its native witness. Each case reconstructs pending intent,
changes the redeemer, rebuilds, and exposes exact datum/redeemer/language details
to a second signer through the production pending card and signing dialog. These
cases use mocked evaluation/chain data and cancel signing; they are not live spends.
The V2 inline case also consumes collateral at the mocked boundary during export
review and asserts zero wallet/clipboard actions before retrying.

Validation on this working tree: all six full-application script-input cases passed;
the full Jest run passed 1,966 CJS and 99 ESM tests, with two environment-gated tests
skipped. TypeScript and scoped formatting checks passed. The configured `next lint`
command remains unavailable in this Next version; no lint pass is claimed.
The full Jest run includes `txDraftImportedPending.test.ts`, which exercises the
actual importer output through pending reconstruction and replacement, alongside
the script-value-sufficient multisig and stale-review regressions.

The live run uses production build `_ERs2AE5JUWr5p0ZuStjU`, built from commit
`00851c5a36ee7418df84abc71ba22f4fa680efd7` plus the uncommitted Phase 3/4 runtime
changes. This is the successful final Phase 4 build; Phase 5 adds fixtures, tests,
runner configuration and evidence without changing application runtime code.
Acceptance uses a local production server, the existing CI wallet bridge with real
payment-key signatures, injected authenticated sessions and real preprod chain
reads, evaluation and submission. It does not test a hardware/browser-extension
wallet or the wallet-login handshake.

## Live runner and recovery

`plutus-acceptance-matrix.spec.ts` is opt-in and serial. The GitHub browser workflow
has a `plutus_matrix` dispatch option; it reuses the existing `ci-preprod-wallets`
concurrency group, runs only this matrix with zero retries, and uploads all partial
records. Local execution requires exclusive use of those shared wallets for the
whole run. Never enable it in an ordinary unfiltered E2E run.

Required settings:

- `RUN_PLUTUS_MATRIX=1`
- `PREPROD_WALLET_COORDINATION=ci-preprod-wallets` after obtaining the exclusive window
- `PREPROD_BUILD_ID` identifying the app build being exercised
- `PREPROD_MATRIX_STATE_DIR` pointing to a persistent, reviewed evidence directory
- The existing preprod CI signer/context configuration and 2-of-3 native wallet

Each case funds exactly 5 test ADA at its script and creates a separate 2 ADA
collateral output. Funding uses the fixture-only unsigned draft operation; both
signers approve through independent pending reviews. Spending and replacement use
the production builder. The runner verifies actual CIP-30 payment-key signatures,
checks the native signing role and fresh replacement witnesses, waits for valid
contract confirmation, and checks the recorded collateral remains unspent.

State files save funding CBOR/hash before persistence, then proposal IDs, original
and replacement bodies, evaluated budgets, verified signer hashes, confirmed outputs
and collateral status. The runner resumes the recorded stage and refuses unrelated
pending rows, wallet/build mismatches and ambiguous missing proposals. It never
selects an arbitrary output from a shared script address. A lock directory prevents
concurrent local matrix attempts and is never automatically broken after a crash.

The runner waits for confirmed funding's native change to reach the address index
and the application's UTxO cache before building. It allows longer reconstruction
timeouts for the shared V2 address, which has hundreds of outputs. During this run,
a stale native input was refused by evaluation before signing; the saved funding
and then the saved proposal were reused after correcting these runner timings.
The following V3 funding attempt also encountered address-index lag: pending review
refused its already-spent native input before any signature. Its exact unsigned
draft was archived, its absence from the chain and zero signatures were checked,
and only that draft was removed. Funding selection now checks the exact candidate
output's consumption status before creating a proposal. Recovery never recreated
an already-funded script output.

After interruption, inspect the state file, pending rows and chain before retrying.
Reuse the same application database, wallet context, build and state directory.
If the database was replaced, recover/import the recorded proposal into the matching
native wallet and reconcile its IDs before resuming; do not launch fresh funding.
Download CI evidence before any new dispatch. A new GitHub runner does not restore
an old database automatically. Keep completed evidence directories as immutable
records; use a new directory only after reconciling all previous funded outputs.
