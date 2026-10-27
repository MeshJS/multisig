# Plutus transaction controls: review gap remediation plan

Status: Phases 0-5 complete. G1-G4 are fixed and G5 has confirmed acceptance evidence; Phase 6 release checks remain planned.

Prepared: 2026-10-26 (Africa/Johannesburg)  
Reviewed branch: `feat/plutus-transaction-controls` at `4a04ded1`

## Objective and scope

Close the four implementation gaps and the acceptance-coverage gap identified in
the branch review. This plan complements the existing
[controls plan](plutus-transaction-controls-plan.md),
[script-risk plan](transaction-script-risk-guardrails-plan.md), and
[release evidence record](transaction-script-risk-release.md).

The feature source is [Plutus Transaction Controls](../vault/features/Plutus%20Transaction%20Controls.md).
No numbered upstream PRD has been assigned in the supplied scope. Implementation
PRs should cite that feature note and this plan until an actual PRD ID exists.

| Gap                            | Observed behavior                                                                           | Target outcome                                                                                   | Phase |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----- |
| G1: Multisig participation     | Script value can cover the entire transaction, omitting the multisig input and script.      | Multisig proposals retain a real signing role for the wallet's approval policy.                  | 1     |
| G2: Imported pending edits     | The import endpoint writes inputs without `type`; the new parser rejects them.              | Supported imported transfers remain editable without guessing or dropping transaction semantics. | 2     |
| G3: Co-signer contract details | Pending review omits the datum, redeemer and execution-budget details shown in the builder. | Co-signers can inspect those details independently from the original CBOR and resolved inputs.   | 3     |
| G4: Stale builder review       | Chain facts are refreshed before the dialog, but not after confirmation.                    | Changed or unavailable facts stop signing/export and require a fresh review.                     | 4     |
| G5: Language/datum acceptance  | Recorded live acceptance covers V2 with inline datum.                                       | Every advertised language/datum combination has separate acceptance evidence.                    | 5     |

Preserve proxy audits, wallet membership, signature verification, original-body
witness merging, required signer retention and replacement concurrency checks.
Automatic collateral creation, reservation and return management remain outside
this work under the separate collateral-service scope. Do not add headless Plutus
creation/signing, a general required-signers editor, or a database migration merely
to close these gaps.

This document schedules implementation and validation. Creating it does not run
live transactions or deploy an application.

## Phase 0: Capture reproducible regression cases

**Depends on:** Nothing. **Addresses:** G1-G5 foundations.

- [x] Convert the review's offline reproductions into focused regression cases
      using the existing Jest and browser harnesses:
  - A 2-of-2 multisig source with script value exceeding payments plus selection
    headroom; the second wallet signs only keys actually requested by the CBOR.
  - The exact input/output JSON shape produced by `importTransaction`, including
    inputs without `type`, alongside its original CBOR.
  - Pending transactions whose datum or redeemer changes while addresses and
    payment amounts remain unchanged.
  - An input becoming spent, or the provider failing, while builder review is open.
- [x] Record the supported reconstruction boundary: ordinary transfers first;
      existing supported Plutus shapes remain supported; unsupported semantics get
      specific reasons rather than silent removal.
- [x] Inventory the current fixture languages and datum sources. Identify which
      results use mocked evaluation, real offline execution, or confirmed preprod
      transactions. Keep those evidence categories separate.
- [x] Record baseline checks and known failures before changing behavior.

**Existing review evidence:** 169 tests across eight focused suites and TypeScript
checking passed. An offline production-builder reproduction emitted no native
script and only the collateral owner's required key for a 2-of-2 source. The
importer's JSON shape passed the base branch's compatibility check and failed this
branch's. A builder action accepted after a simulated input spend during review.
These observations are not full browser or chain acceptance results.

**Exit criteria:** Each implementation gap has a regression that exercises the
production boundary involved, and the five supported acceptance combinations in
Phase 5 have an explicit evidence status.

**Completed 2026-10-26:** See the [Phase 0 regression baseline](plutus-transaction-controls-gap-baseline.md)
for test locations, the reconstruction boundary, the five-row evidence inventory,
reproduction commands and actual check results. Four Jest and five browser cases
are executable expected failures until their implementation phases fix the gaps.
Fixture/control failures remain ordinary failures; no production behavior changed.

## Phase 1: Preserve multisig participation when scripts supply all value

**Depends on:** Phase 0. **Addresses:** G1.

Primary paths: `src/lib/tx-draft/funding.ts`, `to-tx-builder.ts`,
`build-draft-tx.ts`, `src/hooks/useTransaction.ts`, and
`src/utils/transactionReadiness.ts`.

- [x] For multisig-source Plutus proposals, require at least one eligible input
      controlled by the wallet's authoritative native script. In automatic selection,
      retain an eligible multisig input even when the script inputs cover all value.
      Return excess value to the existing source/change address.
- [x] Use available, unblocked funding UTxOs and the existing script-identity
      derivation. Preserve exclusions for explicit script spends and collateral,
      existing proxy constraints, and the edited transaction's input-lock exception.
- [x] Preserve exact manual-selection behavior. If a manual selection cannot
      provide the required wallet input, show an actionable error instead of silently
      adding an unselected UTxO. If no eligible input exists, stop before signing and
      explain what the user must supply or select.
- [x] Check the completed CBOR contains the intended wallet input and matching
      native-script witness. Keep the wallet's existing `any`, `all`, `atLeast`, and
      hierarchical policy semantics; adding every member as a required signer would
      incorrectly turn threshold policies into all-signers policies.
- [x] Keep connected-wallet and other-address flows working when script inputs
      supply all value; the additional wallet-input requirement belongs to multisig
      proposals.
- [x] Add regression coverage for automatic/manual selection, unavailable funding,
      multiple script inputs, token-bearing funding, imported extra required keys,
      collateral-owner witnesses, and a 2-of-2 second signer distinct from that owner.
      Verify the second wallet's signing fixture derives its eligible keys from the
      actual transaction rather than returning an arbitrary signature.

**Exit criteria:** A script-funded 2-of-2 proposal completes independent co-signing
with both payment-key witnesses. Threshold variants retain their original policy,
and missing wallet funding produces a useful error before a wallet prompt.

**Completed 2026-10-26:** The adapter verifies the native script against the source
payment address and prepared network. Selection retains an eligible input from the
caller's available, pending-filtered wallet UTxOs even when no value deficit remains.
Manual selections retain every chosen reference, use available output data and
reject empty, unavailable or incompatible picks. Script spends and collateral stay
excluded; V1 automatic funding skips inline datums. Completion must retain all
selected native input references and the matching native witness in actual CBOR.
No member keys are added as blanket required signers.

`txDraftBuild.test.ts` now treats G1 as an ordinary passing regression. Its real SDK
completion and CBOR tests cover independent 2-of-2 signing, collateral ownership,
`any`/`all`/`atLeast`/hierarchical policies, exact manual input sets, token change,
extra required keys, pending locks and their edit exception, invalid wallet
identity, V1 funding restrictions and deliberate removal of input/script bytes.
Existing proxy audits, witness merging and readiness code require no changes.
Evaluation and chain responses in these tests are deterministic fixtures; live
acceptance remains Phase 5 work.

Validation on the Phase 1 working tree:

- Focused `txDraftBuild.test.ts`: 68 ordinary tests passed.
- Full `npm.cmd test -- --runInBand`: 1,879 CJS and 99 ESM cases accepted;
  includes three remaining expected failures for G2/G4. Two integration tests
  remain skipped by their existing environment gate.
- `npm.cmd run typecheck -- --incremental false`: passed.
- `npm.cmd run build`: passed, with dependency WebAssembly `async/await` target
  compatibility warnings from `whisky-js-browser` and `whisky-evaluator`.
- Risk-component Playwright suite with installed Chrome: 20 cases accepted,
  including the five existing expected failures for G3/G4.
- Prettier and scoped `git diff --check`: passed for Phase 1 code/tests. The
  repository-wide whitespace check still reports the pre-existing user edit in
  `docs/plutus-manual-preprod.md`; that file was left untouched.
- Lint remains unavailable through the repository's existing `next lint` command.

## Phase 2: Restore safe editing of imported pending transactions

**Depends on:** Phase 0. **Addresses:** G2.

Primary paths: `src/server/api/routers/transactions.ts`,
`src/lib/tx-draft/read-pending-inputs.ts`, `from-tx-json.ts`,
`src/components/pages/wallet/build/load-pending-dialog.tsx`, and `build/index.tsx`.

- [x] Introduce a shared compatibility/reconstruction boundary that receives the
      original CBOR, authoritative wallet context, and required resolved chain facts.
      Use it consistently for the pending picker, transaction-card edit action and
      builder deep link; a JSON-only precheck must not disable a recoverable import.
- [x] Recover supported legacy input shapes by checking referenced input addresses
      and the actual transaction witnesses. Do not default every missing `type` to
      `PubKey` or `SimpleScript`.
- [x] Check original CBOR semantics before declaring an import editable. Preserve
      supported outputs, amounts, datums and required signers. Explicitly reject
      unsupported minting, withdrawals, certificates/votes, validity windows,
      reference scripts/inputs, collateral-return controls or other fields that the
      editable draft cannot reproduce.
- [x] Retain the existing supported Plutus reconstruction path, checking its
      input-to-script/datum/redeemer associations against the actual transaction.
      Missing or misleading JSON must not erase an encoded requirement.
- [x] Preserve every ambiguous self-payment/change output when trustworthy builder
      provenance is absent; retain the existing correction notice.
- [x] Support rows already stored in the old import format without a blanket
      database rewrite. Add clearer provenance for future imports only if useful;
      provenance remains advisory and must agree with CBOR.
- [x] Add importer-to-editor integration tests using the actual endpoint output,
      plus ordinary ADA/token transfers, missing/stale JSON, unsupported CBOR fields,
      provider failures, extra required signers, and replacement of partially signed
      proposals. Never reuse old signatures after rebuilding.

**Exit criteria:** An ordinary imported transfer can be loaded, edited and rebuilt
through the real UI path. Unsupported or unresolved imports explain why editing
is unavailable, and supported fields survive the round trip.

**Completed 2026-10-26:** `reconstruct-pending.ts` is the shared CBOR/chain boundary
for the pending picker, card action and builder deep link. It verifies the wallet's
payment script and native witness, resolves historical input ownership and live
availability, and recovers supported outputs, inline datums, required signers and
Plutus script/datum/redeemer associations. Spending redeemers use ledger-ordered
input references. Stored JSON supplies only advisory output provenance, checked
against decoded outputs; absent or stale provenance retains all outputs and the
existing correction notice. Missing/malformed legacy JSON is recoverable.

`pending-governance.ts` retains the existing native staking and DRep-ballot subset
and checks the identities the builder will use. Unsupported certificates/voters,
explicit certificate deposits/refunds, validity windows (including zero), minting,
withdrawals, reference inputs/scripts, output datum hashes, collateral-return
controls, treasury/proposal/update fields and unrepresentable metadata are refused.
External funding owners whose policy the multisig builder cannot reproduce are
also refused. CIP-20 messages retain the builder's supported string/chunk form.
Signer requirements come from CBOR even when JSON omits them. Old signatures and
execution budgets never enter the draft; scripts are evaluated again on rebuild.

Compatibility failures expose retry controls. Loading rechecks chain facts and
discards superseded results after wallet/network/draft/row changes. A successful
retry refreshes the builder's wallet UTxO cache from the resolved chain snapshot;
other pending locks and the edited proposal's lock exception still apply. No
importer contract, database migration, authorization, proxy audit or replacement
concurrency rule changed.

Evidence is recorded in `pendingEditor.test.ts`, `txDraftImportedPending.test.ts`,
the five language/datum round trips in `txDraftBuild.test.ts`, and
`e2e/tests/builder-imported-pending.spec.ts`. The importer integration exercises the
actual endpoint, real rebuilding without old witnesses, and replacement with the
existing concurrent-signature conflict check. Browser fixtures exercise the real
application through all three editor entry points with mocked wallet/chain/pending
responses; they do not persist proposals, sign or broadcast transactions. This
does not add any live acceptance claim to Phase 5.

Validation on the Phase 2 working tree:

- Six focused Jest suites: 186 ordinary tests passed.
- Full `npm.cmd test -- --runInBand`: 1,906 CJS and 99 ESM cases accepted,
  including only the two remaining G4 expected failures. The existing two
  environment-gated tests remain skipped.
- `npm.cmd run typecheck -- --incremental false`: passed.
- `npm.cmd run build`: passed with the existing dependency WebAssembly
  `async/await` target warnings from `whisky-js-browser` and `whisky-evaluator`.
- Full-app `builder-imported-pending.spec.ts`, using installed Chrome against
  the local production build: all three entry-point cases passed. The picker case
  also verifies unavailable-input refusal, retry/cache recovery and a disabled
  validity-window import. The card case verifies navigation after wallet/account
  initialization without discarding an unchanged draft as a stale load.
- Risk-component Playwright suite: 20 cases accepted, including the five
  unchanged G3/G4 expected failures.
- Prettier and scoped whitespace checks passed. Repository-wide `git diff --check`
  still reports the pre-existing user edit in `docs/plutus-manual-preprod.md`;
  that file was left untouched. `npm.cmd run lint` still fails because this Next
  version does not provide the repository's configured `next lint` command.

## Phase 3: Give pending co-signers independent contract details

**Depends on:** Phase 0; reuse Phase 2's decoding primitives where appropriate.
**Addresses:** G3.

Primary paths: `src/lib/tx-risk/transaction.ts`,
`src/hooks/usePendingTransactionReview.ts`,
`src/components/pages/wallet/transactions/pending-risk-review.tsx`,
`transaction-card.tsx`, and the existing builder review components.

- [x] Define a read-only contract-detail model separate from editor compatibility.
      A transaction that cannot be edited must still expose its reviewable details.
- [x] Decode each output's datum with its output index, including distinct outputs
      at the same address. Distinguish inline data, datum hashes and absent data.
- [x] For each Plutus spend, show the input reference, script hash and language,
      datum source/value or hash, redeemer CBOR, and recorded execution budget.
      Associate spending redeemers with ledger-ordered input references, never stored
      JSON or editor order. Resolve reference scripts and hash datums when required;
      report unresolved details explicitly rather than displaying an empty success.
- [x] Label pending budgets as recorded in the transaction. Do not claim a pending
      transaction was freshly evaluated unless a separate evaluation actually ran.
      Decode and display exact data without claiming to interpret contract intent.
- [x] Present these details in the pending card and signing review. Reuse builder
      presentation where practical, retain exact CBOR with copy controls, and make
      long values usable on mobile and with keyboard navigation.
- [x] Ensure datum-only transactions can trigger the appropriate detail review
      even if there are no script-risk findings. Preserve existing acknowledgment,
      collateral and required-key displays, and invalidate details on replacement.
- [x] Define required facts for supported Plutus-spend review. Their absence must
      block the action with a retry/correction state; missing optional labels must not.
      Keep unrelated transaction types working under their existing review policy.
- [x] Test independent proposer/co-signer views, changed datum/redeemer with equal
      payment amounts, reordered inputs, duplicate recipient addresses, supplied vs
      inline datums, large integers, missing JSON and missing provider facts.

**Exit criteria:** A co-signer can inspect the exact contract arguments and recorded
budgets they are approving, including after replacement, without trusting the
proposer's stored JSON or opening the transaction editor.

**Completed 2026-10-26:** `contract-details.ts` adds a read-only model to the
shared transaction assessment. It decodes every output's inline datum, datum hash
or absence of data with its zero-based ledger index, including collateral return.
Spending redeemers are associated with ledger-sorted input references. The review
retains script hash/language, source, exact datum/redeemer CBOR, decoded data and
recorded memory/step budgets. Decoded JSON remains text so large integer values
are not rounded by JavaScript. No stored transaction JSON or editor compatibility
decision is involved.

Required facts for an identified Plutus spend are a unique live input on the
selected network, a hash-matching script/language from transaction witnesses or
live spending/reference inputs, exactly one correctly indexed spending redeemer,
and its recorded budget. Inline datums are decoded and checked against any
reported hash; hash datums must match a datum witness in the transaction. Fetching
an external datum cannot substitute for a missing witness. Missing, ambiguous,
malformed, spent or mismatched required facts make review incomplete and block
signing with retry/correction guidance. Output-only datum hashes need no external
value lookup. Optional labels and unrelated native/staking/governance review
policies remain unchanged; this model does not infer Plutus from an arbitrary
script address alone or add minting/governance redeemer inspection.

Both the pending card and each signing dialog show the independent details.
Datum-only transactions now require a review decision even with no risk findings.
Existing danger acknowledgment, collateral and required-key information remain.
The shared `contract-data-value.tsx` presentation adds named copy controls and
bounded, keyboard-scrollable values to pending and builder views. Pending budgets
are explicitly recorded values; no fresh evaluation or contract-intent claim is
made. Replacement and contract-witness changes invalidate an open review, even if
the body hash is unchanged, while payment-key witness additions retain it. The
existing final pending refresh also compares the new detail model.

Evidence: `contractDetails.test.ts` covers ledger ordering, duplicate recipients,
large integers, V1/V2/V3 supplied datums, reference scripts, missing facts,
datum-only decisions and changed facts during confirmation. The five existing
language/datum build round trips now compare independent co-signer details with
the actual proposer arguments and evaluated budgets. Browser regressions exercise
the production hook/dialog with real-codec assessments supplied at the resolver
boundary, including replacement, missing-datum retry, mobile layout, exact copy,
keyboard navigation and focus restoration. G3's three expected-failure markers
are removed. This is serialization, SDK-build and component-browser evidence;
Phase 5's live acceptance matrix and Phase 6's human screen-reader check remain
pending. No transaction was signed by a live wallet or broadcast.

Validation on the Phase 3 working tree:

- Five focused Jest suites: 143 ordinary tests passed.
- Full Jest run: 1,925 CJS and 99 ESM cases accepted, including the two remaining
  G4 expected failures; two existing environment-gated tests remain skipped.
- Risk-component Playwright suite: 24 cases accepted (22 ordinary passes and two
  remaining G4 expected failures), using installed Chrome. Mobile screenshot
  inspected at `ci-artifacts/risk-components/pending-contract-mobile.png`.
- TypeScript and the final production build passed. The build retains the
  existing dependency WebAssembly `async/await` target warnings from
  `whisky-js-browser` and `whisky-evaluator`.
- Scoped Prettier and `git diff --check` passed. The existing `next lint` command
  remains unavailable; no lint pass is claimed.

## Phase 4: Revalidate after builder confirmation

**Depends on:** Phase 0; integrate the detail model from Phase 3.
**Addresses:** G4.

Primary paths: `src/lib/tx-risk/review.ts`, `pending-review.ts`,
`src/components/pages/wallet/build/index.tsx`, `src/hooks/useTransaction.ts`,
and `useSignAndSubmit.ts`.

- [x] Refresh mandatory transaction facts after the user confirms the builder
      dialog and before calling a wallet or copying unsigned CBOR. Reuse the pending
      review policy where practical so the two paths do not drift.
- [x] Compare the fresh assessment against what the user reviewed, including
      contract details added in Phase 3. Bind acceptance to the original CBOR, network,
      draft revision, funding source, account and wallet identity.
- [x] On changed or incomplete facts, refuse the action and show the updated
      review or a clear retry/rebuild state. Require a new decision and acknowledgment;
      do not reuse the previous checkbox state or silently rebuild the transaction.
- [x] Preserve freshness checks after asynchronous proxy auditing and wallet
      operations, and retain readiness checks before submission. Be explicit that
      chain checks establish availability at a point in time, not a UTxO reservation.
- [x] Test spending-input and collateral consumption during the dialog, provider
      failure, account/network/source changes during refresh, cancellation, unsigned
      export, replacement, connected signing, and unchanged-facts success. Assert zero
      wallet/clipboard calls when the final refresh fails.

**Exit criteria:** The reproduced stale-input case is refused; successful actions
use the exact reviewed bytes after a successful final refresh. Pending review
retains the same behavior.

**Completed 2026-10-27:** Builder and pending signing now share
`revalidate-review.ts` for their final uncached chain assessment. After confirmation,
the builder resolves the original CBOR again and compares the complete assessment,
including contract datum/redeemer data and recorded budgets. Changed or incomplete
facts throw actionable retry/rebuild guidance before any wallet or clipboard call.
Provider exceptions also fail closed. Each retry opens a new decision with an
unchecked acknowledgment; no transaction is silently rebuilt and no acceptance is
retained. Ordinary key transfers keep their concise flow while also revalidating.

The existing builder currentness callback binds draft revision/source, exact site
network, account, signer instance and wallet identity/script. It is checked around
the final refresh alongside the original CBOR and displayed assessment binding.
Multisig proposal/replacement review now follows the asynchronous proxy audit so
the audit cannot delay the final chain check. Existing currentness checks after
wallet operations and readiness checks before submission remain intact. The dialog
explicitly states that availability checks do not reserve spending inputs or
collateral. No authorization, witness merging or replacement concurrency rule changed.

Evidence: `txRiskReview.test.ts` exercises real-codec/provider-boundary input and
collateral consumption, provider failures, contract-detail changes, cancellation,
unchanged bytes and draft/source/account/network/wallet/replacement changes during
both confirmation and final refresh. `useTransactionReview.test.ts` connects that
guard to proposal, replacement and connected-signing hooks, plus the unsigned-export
action boundary. Failed final checks produce zero wallet/clipboard/persistence calls;
successful checks use the exact reviewed bytes without recompletion. Browser G4
regressions now pass normally for signing/export and prove retry requires a new
acknowledgment. Pending review retains its final-refresh refusal tests. These are
deterministic fixtures and component-browser checks, not live chain acceptance.

Validation on the Phase 4 working tree:

- Full Jest run: 1,958 CJS and 99 ESM tests passed, with two existing
  environment-gated tests skipped. No G4 expected-failure markers remain.
- Final four focused Jest suites: 101 tests passed, including the two explicit
  wallet-identity invalidation cases added after the full run.
- Risk-component Playwright suite: all 24 tests passed using installed Chrome.
  This includes both former G4 expected failures and unchanged pending/MCP cases.
- TypeScript and production build passed. The build retains the existing
  dependency WebAssembly `async/await` target warnings from `whisky-js-browser`
  and `whisky-evaluator`.
- Scoped Prettier and repository-wide `git diff --check` passed. `npm.cmd run lint`
  still fails because this Next version does not provide the configured
  `next lint` command; no lint pass is claimed.
- Live language/datum acceptance and release gates remain Phase 5/6 work.

## Phase 5: Complete the advertised language/datum acceptance matrix

**Depends on:** Phases 1-4. **Addresses:** G5 and integrated behavior.

Extend `scripts/plutus-manual-fixture.mjs`, the existing builder/preprod Playwright
specs, [manual preprod guide](plutus-manual-preprod.md), and release evidence.

| Script language | Datum source                             | Evidence required on the final build                      |
| --------------- | ---------------------------------------- | --------------------------------------------------------- |
| V1              | Supplied datum matching an on-chain hash | Offline execution, full-app flow, confirmed preprod spend |
| V2              | Inline datum                             | Same; rerun the existing scenario after remediation       |
| V2              | Supplied datum matching an on-chain hash | Offline execution, full-app flow, confirmed preprod spend |
| V3              | Inline datum                             | Offline execution, full-app flow, confirmed preprod spend |
| V3              | Supplied datum matching an on-chain hash | Offline execution, full-app flow, confirmed preprod spend |

- [x] Use actual language-compatible validators and retain their source/provenance,
      script bytes and hashes. Relabelling the existing V2 fixture does not establish
      V1 or V3 execution support. Keep V1-plus-inline combinations explicitly rejected.
- [x] Create hash-datum funding outputs through a dedicated fixture helper; the
      user-facing output controls remain inline-only unless separately scoped.
- [x] Exercise each row through funding, script/datum resolution, evaluation,
      proposer review, owner signing, independent co-signing and confirmation. Record
      the resulting outputs and whether the recorded collateral remained unspent.
- [x] Cover script-value-sufficient multisig funding, pending import/edit, redeemer
      replacement with old signatures discarded, and independent contract-detail
      review across the integration suite. Run stale-fact refusal scenarios with
      controlled boundary mocks rather than creating unnecessary conflicting spends.
- [x] Keep live runners opt-in, preprod-only and limited to disposable test ADA.
      Record partial progress and recovery references before retries; recover previous
      fixture outputs instead of blindly funding new ones. Reuse existing runner
      coordination to avoid concurrent use of shared wallets.
- [x] For each case retain commit/build, wallet threshold, language/script hash,
      funding reference, datum/redeemer bytes, evaluated budgets, proposed/replacement
      hashes, verified witnesses, confirmation hash and collateral outcome.
- [x] If a combination fails, fix it and rerun, or explicitly narrow the advertised
      support and document the limitation. Do not mark unexecuted rows as accepted.

**Exit criteria:** All five advertised combinations have evidence from the final
implementation. Mocked serialization and offline execution are recorded separately
from chain confirmation.

**Completed 2026-10-27:** All five combinations passed real offline execution,
full-application mocked-boundary coverage and confirmed preprod acceptance on the
final Phase 4 production build. The
[acceptance matrix](plutus-acceptance-matrix.md) and
[public chain evidence](evidence/plutus-acceptance-2026-10-27.json) retain the exact
validators, build identity, funding references, original/replacement bodies' hashes,
arguments, budgets, verified signer hashes, outputs and collateral outcomes.
V1/V3 have reproducible repository-authored validators; V2 retains the published
Hydra fixture. V1 inline remains rejected and hash-output funding is fixture-only.

The serial, opt-in live runner preserves recovery state before persistence and
uses the existing `ci-preprod-wallets` coordination. Interrupted cases reused their
recorded funding/proposals. Address-index lag and slow shared-address resolution
required runner timing and funding-input checks; application guards refused stale
inputs before signing. A rejected, unsigned and unsubmitted funding draft was
archived and replaced only after checking its chain and signature state. No runtime
guard was weakened and no application runtime code changed in Phase 5.

Validation: ten real offline executions (two redeemers per case), six full-app
mocked-boundary tests, and all five live flows passed. Full Jest passed 1,966 CJS
and 99 ESM tests, with two environment-gated tests skipped. TypeScript, scoped
Prettier and `git diff --check` passed. The independent exporter reverified every
confirmed script spend and all five unspent collateral outputs. The existing
`next lint` command remains unavailable; no lint pass is claimed. Production build
`_ERs2AE5JUWr5p0ZuStjU` is the successful Phase 4 build, reused unchanged for live
acceptance. Human accessibility and deployment-specific gates remain Phase 6.

## Phase 6: Integrate, reconcile documentation and complete release checks

**Depends on:** Phases 1-5. **Addresses:** Completion of G1-G5.

- [ ] Run relevant focused tests with each implementation phase, then the full
      repository test suite, TypeScript, production build and affected browser suites.
      Include ordinary transfers, native-script policies, proxy workflows, staking,
      governance, witness merging, pending replacement and MCP review regressions.
- [ ] Reconcile the existing plans' status text with actual evidence. The controls
      plan still describes acceptance as pending, while the release record contains a
      successful V2 inline run. Preserve that historical result and add the new matrix
      without treating it as proof for other language/datum combinations.
- [ ] Update the feature note, user review guide and module documentation with
      multisig funding prerequisites, import compatibility, contract-detail review,
      freshness behavior and confirmed support limits. Update API/MCP documentation
      only where a contract or displayed review payload changes.
- [ ] Complete the existing human mobile/screen-reader check, including long datum
      and redeemer values, named copy controls, focus restoration and retry states.
- [ ] Record the release build, deployment-specific smoke results and rollback
      build using the existing release gates. Deliver builder and pending review
      changes together; do not disable one signing guard to work around a failure.

Suggested checks during implementation:

```powershell
npm.cmd run typecheck
npm.cmd run test:ci
npx.cmd playwright test -c e2e/risk-components.config.ts
node scripts/plutus-manual-fixture.mjs
git diff --check
```

Use the existing full-app and opt-in preprod commands from the release guide with
the specific specs for this plan. The recorded `npm run lint` baseline fails
because the installed Next version does not provide `next lint`; report its actual
status and use a verified working lint invocation if available. Do not count the
broken command as passing.

**Exit criteria:** Every gap is covered by implementation and evidence, all required
checks have an explicit result, and release documentation names any remaining
deployment gates. Mark the feature delivered only after those gates are complete.

## Delivery order and definition of done

Implement Phase 0 first, then Phases 1-4 as reviewable changes with their own
regressions. Phase 3 should reuse Phase 2's verified decoding where possible;
Phase 4 must bind the resulting review details. Integrate before running Phase 5
against the final build, then finish Phase 6.

The work is complete when:

- Multisig script spends retain the intended approval policy even when script
  value supplies the full payment and fee.
- Supported existing imports remain editable without semantic or signature loss.
- Each pending signer can inspect the actual datums, redeemers and recorded budgets.
- Builder signing/export rejects changed or unavailable facts after confirmation.
- Every advertised language/datum combination has confirmed acceptance evidence,
  and the documented release gates are satisfied.
