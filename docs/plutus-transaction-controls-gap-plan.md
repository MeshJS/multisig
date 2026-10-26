# Plutus transaction controls: review gap remediation plan

Status: Phases 0-2 complete. G1 and G2 are fixed; Phases 3-6 remain planned.

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

- [ ] Define a read-only contract-detail model separate from editor compatibility.
      A transaction that cannot be edited must still expose its reviewable details.
- [ ] Decode each output's datum with its output index, including distinct outputs
      at the same address. Distinguish inline data, datum hashes and absent data.
- [ ] For each Plutus spend, show the input reference, script hash and language,
      datum source/value or hash, redeemer CBOR, and recorded execution budget.
      Associate spending redeemers with ledger-ordered input references, never stored
      JSON or editor order. Resolve reference scripts and hash datums when required;
      report unresolved details explicitly rather than displaying an empty success.
- [ ] Label pending budgets as recorded in the transaction. Do not claim a pending
      transaction was freshly evaluated unless a separate evaluation actually ran.
      Decode and display exact data without claiming to interpret contract intent.
- [ ] Present these details in the pending card and signing review. Reuse builder
      presentation where practical, retain exact CBOR with copy controls, and make
      long values usable on mobile and with keyboard navigation.
- [ ] Ensure datum-only transactions can trigger the appropriate detail review
      even if there are no script-risk findings. Preserve existing acknowledgment,
      collateral and required-key displays, and invalidate details on replacement.
- [ ] Define required facts for supported Plutus-spend review. Their absence must
      block the action with a retry/correction state; missing optional labels must not.
      Keep unrelated transaction types working under their existing review policy.
- [ ] Test independent proposer/co-signer views, changed datum/redeemer with equal
      payment amounts, reordered inputs, duplicate recipient addresses, supplied vs
      inline datums, large integers, missing JSON and missing provider facts.

**Exit criteria:** A co-signer can inspect the exact contract arguments and recorded
budgets they are approving, including after replacement, without trusting the
proposer's stored JSON or opening the transaction editor.

## Phase 4: Revalidate after builder confirmation

**Depends on:** Phase 0; integrate the detail model from Phase 3.
**Addresses:** G4.

Primary paths: `src/lib/tx-risk/review.ts`, `pending-review.ts`,
`src/components/pages/wallet/build/index.tsx`, `src/hooks/useTransaction.ts`,
and `useSignAndSubmit.ts`.

- [ ] Refresh mandatory transaction facts after the user confirms the builder
      dialog and before calling a wallet or copying unsigned CBOR. Reuse the pending
      review policy where practical so the two paths do not drift.
- [ ] Compare the fresh assessment against what the user reviewed, including
      contract details added in Phase 3. Bind acceptance to the original CBOR, network,
      draft revision, funding source, account and wallet identity.
- [ ] On changed or incomplete facts, refuse the action and show the updated
      review or a clear retry/rebuild state. Require a new decision and acknowledgment;
      do not reuse the previous checkbox state or silently rebuild the transaction.
- [ ] Preserve freshness checks after asynchronous proxy auditing and wallet
      operations, and retain readiness checks before submission. Be explicit that
      chain checks establish availability at a point in time, not a UTxO reservation.
- [ ] Test spending-input and collateral consumption during the dialog, provider
      failure, account/network/source changes during refresh, cancellation, unsigned
      export, replacement, connected signing, and unchanged-facts success. Assert zero
      wallet/clipboard calls when the final refresh fails.

**Exit criteria:** The reproduced stale-input case is refused; successful actions
use the exact reviewed bytes after a successful final refresh. Pending review
retains the same behavior.

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

- [ ] Use actual language-compatible validators and retain their source/provenance,
      script bytes and hashes. Relabelling the existing V2 fixture does not establish
      V1 or V3 execution support. Keep V1-plus-inline combinations explicitly rejected.
- [ ] Create hash-datum funding outputs through a dedicated fixture helper; the
      user-facing output controls remain inline-only unless separately scoped.
- [ ] Exercise each row through funding, script/datum resolution, evaluation,
      proposer review, owner signing, independent co-signing and confirmation. Record
      the resulting outputs and whether the recorded collateral remained unspent.
- [ ] Cover script-value-sufficient multisig funding, pending import/edit, redeemer
      replacement with old signatures discarded, and independent contract-detail
      review across the integration suite. Run stale-fact refusal scenarios with
      controlled boundary mocks rather than creating unnecessary conflicting spends.
- [ ] Keep live runners opt-in, preprod-only and limited to disposable test ADA.
      Record partial progress and recovery references before retries; recover previous
      fixture outputs instead of blindly funding new ones. Reuse existing runner
      coordination to avoid concurrent use of shared wallets.
- [ ] For each case retain commit/build, wallet threshold, language/script hash,
      funding reference, datum/redeemer bytes, evaluated budgets, proposed/replacement
      hashes, verified witnesses, confirmation hash and collateral outcome.
- [ ] If a combination fails, fix it and rerun, or explicitly narrow the advertised
      support and document the limitation. Do not mark unexecuted rows as accepted.

**Exit criteria:** All five advertised combinations have evidence from the final
implementation. Mocked serialization and offline execution are recorded separately
from chain confirmation.

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
