# Transaction script risk guardrails implementation plan

Status: Phases 0–3 implemented. Builder warnings and signing/export review are connected. Phases 4–6 remain planned; pending co-signer and MCP review are not yet integrated.

Prepared: 2026-10-21

## Objective

Help transaction authors and co-signers understand when an output is controlled by a script, when a known script lets anyone spend it, and whose collateral is exposed. Show the consequences before a wallet signature or unsigned export, including ordinary transfers that contain no datum or Plutus input.

The builder interacts with supplied scripts and script addresses; it does not generally create their spending rules. Product copy should describe sending to a script or spending a script output, rather than imply the builder has audited or created a contract.

This plan follows repository inspection and the community-testing discussion. It complements [Plutus transaction controls](plutus-transaction-controls-plan.md) and [the preprod fixture guide](plutus-manual-preprod.md). On 2026-10-21, the maintainer confirmed that these guardrails belong to Andre's October output-datum and Plutus script-spend/redeemer tasks. That supplied scope is now recorded under the stable vault graph ID [Plutus Transaction Controls](../vault/features/Plutus%20Transaction%20Controls.md), linked from the roadmap. No numbered upstream PRD or GitHub issue was supplied; reference that feature note until an actual ID is available. #221 remains separate collateral-management work.

## Current implementation and gaps

Paths are relative to the repository root. Proposed new files are identified explicitly in the phases below.

| Area                  | Existing implementation                                                                                                    | Consequence for this work                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft intent          | `src/types/tx-draft.ts`, `src/lib/tx-draft/mutations.ts`, `src/lib/zustand/tx-builder.ts`                                  | Outputs have stable IDs; script inputs and collateral are separate intent. Derive warnings rather than storing trusted risk labels in the draft.                                                                    |
| Validation            | `src/lib/tx-draft/validate.ts`, `validate-plutus.ts`                                                                       | Already distinguishes errors/warnings and anchors issues to outputs/inputs. No recipient spending-policy classification is present in the inspected flow.                                                           |
| Output editing        | `src/components/pages/wallet/build/inspector/output-inspector.tsx`, `problems-panel.tsx`, `builder-canvas.tsx`             | Add visible recipient warnings outside collapsed Advanced controls. A datum is neither necessary nor sufficient to identify a script recipient.                                                                     |
| Completed transaction | `src/lib/tx-draft/build-draft-tx.ts`, `outputs.ts`                                                                         | Provides unsigned CBOR, body hash, final output review and optional Plutus review. `OutputReview` currently describes ADA and datum, not all token exposure.                                                        |
| Input verification    | `src/lib/tx-draft/resolve-script-inputs.ts`, `prepare-plutus.ts`, `evaluate-plutus.ts`                                     | Already resolves live inputs, matches script/version to payment hash, checks data and evaluates exact completed bytes. Reuse these facts; evaluation is not a safety certification.                                 |
| Builder review        | `src/components/pages/wallet/build/index.tsx`, `build-result-panel.tsx`, `output-review-list.tsx`, `plutus-review.tsx`     | `reviewBeforeSigning` currently skips the dialog without Plutus review, extra required signatures or an inline datum. A plain payment to a dangerous script needs to trigger review too.                            |
| Signing               | `src/hooks/useTransaction.ts`, `useSignAndSubmit.ts`                                                                       | Proposal signing supports `beforeSign`; connected-wallet signing uses the builder review and freshness callback. A one-approval multisig can submit immediately, so review must precede the first wallet signature. |
| Pending co-signing    | `src/components/pages/wallet/transactions/transaction-card.tsx`, `collateral-review.tsx`                                   | Collateral review is visible outside collapsed details; `signTx` also performs the existing proxy audit. Add recipient/input risk review before its direct wallet-signing call.                                     |
| Collateral            | `src/lib/tx-draft/collateral.ts`, `src/utils/transactionReadiness.ts`                                                      | Builder verifies full exposure without collateral return; pending review accounts for a recorded return and required keys. Extend existing presentation rather than create competing calculations.                  |
| MCP review            | `src/lib/tx-review/{preview,propose,review,summary,card}.ts`, `src/lib/mcp/apps/review-card.ts`                            | Text, HTML and PNG already render warnings. Pending review currently summarizes `txJson` and passes an empty warning list; risk facts must come from `txCbor`.                                                      |
| Test coverage         | `src/__tests__/txDraft*.test.ts`, `txReview*.test.ts`, `e2e/tests/builder-{output-datum,script-inputs,collateral}.spec.ts` | Extend existing real-codec fixtures and browser coverage for warning visibility and signing gates.                                                                                                                  |

## Scope and recommended policy

Initial scope includes the canvas builder's multisig, connected-wallet and unsigned-export modes; replacement editing; pending cards regardless of proposal origin; and existing MCP review surfaces. Preserve current authorization, witness checks, proxy audits and supported transaction features.

Do not add a contract editor, arbitrary code analysis, a remote reputation service, a global trusted-address list, automatic collateral management or new headless Plutus capabilities. UI acknowledgment is an informed-review step, not an on-chain restriction or a security boundary for external clients. A server-enforced transaction policy would be separate work.

| Observed condition                                                       | Message and treatment                                                                                                                                                 | Confirmation                                                                                                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Key-controlled payment output, including one with an inline datum        | No script-control warning. Keep existing datum review.                                                                                                                | Existing behavior.                                                                                                                                     |
| Output controlled by the current wallet's verified native payment script | Identify as the wallet's script; do not claim that ordinary change loses multisig protection.                                                                         | No additional risk acknowledgment solely for using a script address.                                                                                   |
| Other script payment credential with unknown rules                       | “Funds sent here follow this script's spending rules. Your current wallet's approval requirements may no longer apply. These rules have not been verified.”           | Visible final review; no extra checkbox for every unknown contract.                                                                                    |
| Exact match to the known always-true payment script                      | “Anyone can spend funds sent to this script. Your multisig approvals will not protect them after this transfer.” Show ADA and every token affected.                   | Unchecked acknowledgment before signing or export on every network; prominent destructive styling and mainnet wording on mainnet. No global dismissal. |
| Spending an output at that known script                                  | “This input can be spent by anyone and may be spent before your transaction confirms.”                                                                                | Informational input warning; do not imply that recovering funds creates the same outgoing exposure. Apply output warnings separately.                  |
| Other Plutus input                                                       | “Execution was evaluated for this transaction. This does not verify the contract's safety or the intended outcome.” Use “not evaluated” where no evaluation occurred. | Existing evaluated-transaction review, with clearer scope.                                                                                             |
| Selected collateral                                                      | Show owner, selected amount, return if present, and maximum exposure. Explain exposure if an included transaction fails script execution.                             | Preserve existing checks; distinguish exposure from the minimum collateral requirement and ordinary fees.                                              |
| Mandatory transaction decoding or required chain verification fails      | “Unable to verify this transaction. Retry before signing.”                                                                                                            | Block the affected signing/export action until review can be produced; never display an empty warning list as successful analysis.                     |

Unknown rules are a normal classification, not a failed review. A valid unknown script should remain usable. Recognizing a script hash is not a general claim of safety. Address labels, contacts, transaction descriptions and proposer-supplied JSON must not suppress warnings.

Recommended first release uses explicit acknowledgment for known anyone-can-spend outputs, rather than an absolute mainnet ban. Any later blocking policy needs its own product decision and consistent enforcement across applicable clients. Testnet copy must still explain loss of control; an `addr_test` prefix alone cannot distinguish preprod from preview.

## Phase 0 — Establish fixtures and the review contract

**Depends on:** no runtime work. **Deliverable:** agreed policy and representative transactions.

- [x] Reconcile the maintainer-supplied roadmap scope with the policy table; record source modes and review entry points in the [module contract](../src/lib/tx-risk/README.md). The missing numbered PRD/issue is explicit in the vault note.
- [x] Verify installed Mesh/CSL address credential and CBOR APIs against the lockfile. Decode the payment credential explicitly: a script stake credential alone must not classify the payment as script-controlled, and an address alone does not distinguish native from Plutus scripts.
- [x] Establish an exact known-script fixture using `scripts/plutus-manual-fixture.mjs`: Plutus V2 CBOR `49480100002221200101`, hash `3a888d65f16790950a72daee1f63aa05add6d268434107cfa5b67712`. Assert hash derivation with its language version. Do not match on the published preprod address string alone.
- [x] Prepare enterprise/base address variants, mainnet/testnet variants, key-payment/script-stake addresses, current-wallet native script outputs, unknown script outputs, multiple outputs to one address, and token-bearing outputs.
- [x] Define behavior for legacy/imported pending CBOR that the editor cannot reconstruct. Review must not require `isDraftCompatible` or silently drop unsupported transaction features.

**Acceptance:** fixtures and copy distinguish funding, spending and collateral, with no “safe contract” status. Document remaining upstream-spec dependencies before implementation.

## Phase 1 — Shared script risk assessment

**Depends on:** Phase 0. **Deliverable:** deterministic assessment usable by browser and server.

- [x] Add a shared module under `src/lib/tx-risk/` for address classification, a small evidence-backed known-script registry and transaction assessment. Keep presentation and network fetching outside the pure classifier.
- [x] Model findings with stable codes, severity, action (`fund-script`, `spend-script`, `collateral`), evidence, script payment hash, output index/input reference, affected assets and acknowledgment requirement. Include explicit completeness/error state and an assessment version.
- [x] Provide a lightweight draft adapter for early output feedback and a CBOR adapter for final review. Completed transaction bytes are authoritative. Final assessment uses ledger output indexes, never unverified draft IDs; verified UI correlation belongs to phase 3. Inspect all emitted outputs, including change and conditional collateral return.
- [x] Match the known validator by the decoded payment script hash. Where bytes are supplied, derive the hash using the declared language and preserve existing on-chain matching. Modified scripts and lookalike addresses remain unknown unless independently recognized.
- [x] Identify own-wallet native control using authoritative wallet script derivation and hash matching. Do not exempt every script, every contact, every proxy or every address labelled “self.” Match known-dangerous scripts before applying contextual exemptions.
- [x] Keep amounts as base-unit integer strings/BigInt. Preserve distinct output indexes and asset units even when display names or addresses coincide.
- [x] Treat missing optional contract metadata as unknown rules. Treat malformed transaction bytes as incomplete review. Resolve spending-input and collateral facts through existing provider abstractions; do not invent owner/value facts from `txJson`.
- [x] Reuse a `DraftIssue` adapter for editor navigation, while keeping semantic risk findings separate from ledger-validity errors. No schema migration or stored acknowledgment field was added.

**Acceptance:** unit tests prove exact detection across address/network variants, no false positive for a script stake credential or a key output with datum, correct own-wallet handling, and preserved output/token identities. Modified scripts are not declared safe or automatically classified as always-true.

### Phases 0–1 implementation notes

- Code and trust-boundary details: [shared assessment contract](../src/lib/tx-risk/README.md). Deterministic real-codec fixtures live in `src/__tests__/fixtures/tx-risk.ts`; regression tests in `src/__tests__/txRisk.test.ts`.
- Installed Mesh core/core-csl 1.9.1 required two explicit codec guards: check payment address kind before reading `payment_cred()` (reward addresses also expose a credential), and reject trailing CBOR bytes before CSL transaction decoding. No transaction reserialization is used to enforce that check.
- The assessment does not execute contracts or establish ledger/signature validity. Incomplete input/provider facts retain outgoing warnings and prevent a complete result. Unknown rules remain usable; known-dangerous outputs carry an acknowledgment requirement for future UI phases.
- Existing collateral inspection is reused. Imported ADA-only collateral with multiple owners or an existing return can be reviewed; unsupported token collateral is explicit. Return destinations are classified as conditional outputs. No collateral creation or return management was added.
- Phases 0–1 introduced the assessment only. The subsequent builder integration is recorded below; pending co-signer and MCP integration remain future work.
- Verification on 2026-10-21: 249 tests passed across 10 suites covering the new risk assessment, draft validation, collateral, script inputs, output datums, pending reconstruction, builder store and vault graph/proofs. TypeScript and formatting checks passed; all local documentation links resolved. The real offline fixture reproduced the published address and executed redeemers `01` and `02` successfully; no on-chain acceptance is claimed.
- Lint remains unverified because of repository tooling failures: `npm run lint` invokes `next lint`, which treats `lint` as a nonexistent project directory with the installed Next version. Direct ESLint 9.39.5 fails during configuration loading with a circular React-plugin structure. No lint configuration changes were made in this scope.

## Phase 2 — Contextual builder feedback

**Depends on:** Phase 1. **Deliverable:** understandable warnings while editing.

- [x] Add a proposed reusable risk-summary component and output-level indicators in `output-inspector.tsx`, the builder canvas projection (`src/utils/token-flow/from-draft.ts`) and `problems-panel.tsx` as appropriate.
- [x] Keep a concise warning visible when Advanced is collapsed. Selecting a finding must focus its exact output/input, including duplicate addresses.
- [x] Show control-change copy as soon as a complete valid recipient address is available. Do not show a danger alert on every keystroke of an incomplete address; retain ordinary address validation.
- [x] Add the specific warning for known anyone-can-spend recipients even without an inline datum, collateral or a Plutus input.
- [x] Extend `script-inputs-editor.tsx` with input-specific risk context and `plutus-review.tsx` with the evaluation limitation. Keep detailed CBOR and execution budgets secondary to consequences and amounts.
- [x] Reuse `collateral-editor.tsx` and its visible summary. Clarify collateral ownership and failure exposure without suggesting that a rejected local build automatically spends collateral.
- [x] Use source-appropriate language: connected-wallet and arbitrary-address modes should say “your wallet” rather than claim the source is always a multisig.

**Acceptance:** a plain 5 ADA transfer to the fixture address warns immediately; removing/changing that recipient updates the warning; datum-only key outputs and ordinary native multisig change do not acquire a misleading danger warning. Keyboard and mobile users can reach the same details.

## Phase 3 — Bind final review to the transaction being signed or exported

**Depends on:** Phases 1–2. **Deliverable:** review cannot be skipped by choosing a different builder action.

- [x] Attach a completed risk assessment to `DraftBuildResult`, based on `unsignedTx`; show final ADA amounts after minimum-output adjustment and all native assets. Extend `OutputReview`/`OutputReviewList` or pass an authoritative asset view alongside them.
- [x] Generalize `datumReview`/`reviewBeforeSigning` in builder `index.tsx` into transaction review. Include recipient risks in the opening condition so funding-only transactions cannot bypass review.
- [x] Include warnings in `build-result-panel.tsx`. Keep “built successfully” separate from safety: successful construction/evaluation must not visually clear a risk finding.
- [x] Add an unchecked “I understand anyone can spend these funds” acknowledgment for known-dangerous outgoing outputs. List every affected output and asset; provide an obvious cancel/edit action. Build/evaluate remains available without acknowledgment.
- [x] Gate multisig `Build & propose`, connected-wallet `Build & sign`, replacement signing and unsigned-CBOR copy/export using the reviewed transaction. Reuse `useTransaction`'s `beforeSign` hook and existing freshness callbacks instead of duplicating transaction construction.
- [x] Bind local acceptance to transaction body hash, network, active signer/account, wallet/source context and assessment version. Clear it on relevant draft/environment changes, dialog cancellation and pending replacement. Never import another person's acknowledgment or persist a blanket trust choice.
- [x] Recheck identity/currentness immediately before signing/export and after asynchronous steps. Witness additions by other signers must not be confused with a changed transaction body, but newly observed risk facts must trigger fresh review.
- [x] Preserve proxy pre-sign audits and `transactionReadiness`; risk acknowledgment cannot override those failures. Ensure one-approval wallets review before their potentially immediate broadcast.

**Acceptance:** browser tests assert zero wallet-sign/submit calls after cancel, missing acknowledgment or stale review. Every supported builder action presents the same output risks, and existing normal-payment workflows remain concise.

### Phases 2–3 implementation notes

- Contextual findings appear in the output inspector, script-input editor, canvas output labels and Problems navigation. Exact output IDs keep duplicate recipients distinct. Warnings stay outside Advanced controls; invalid partial addresses retain ordinary validation.
- Browser builds opt into completed-CBOR assessment. Build results show adjusted ADA and exact native-token quantities, with construction/evaluation explicitly separated from contract safety. No acknowledgment is required to build.
- The shared action guard refreshes mandatory input/collateral facts for every signing or copy action, validates the body hash/network/assessment version, and requires a fresh unchecked acknowledgment for anyone-can-spend outputs. Unknown contracts get review without a danger checkbox. Incomplete review blocks both actions.
- Multisig proposals, replacements and connected signing use the same guard as unsigned-CBOR copy. Draft/source/account/network changes and closing the dialog invalidate local decisions. Existing proxy audits and readiness checks remain; currentness is checked again after the asynchronous proxy audit before opening the wallet signature prompt.
- Regression evidence on 2026-10-21: 279 Jest tests passed across 11 suites, including real serialized transactions, final output amounts, duplicate-output identity and signing-hook cancellation/freshness. Five isolated Playwright component tests passed in Chromium with mobile/keyboard checks and zero action callbacks after cancellation, missing acknowledgment or invalidation. These mount production review components and the shared guard with mocked action/provider boundaries; they are not full authenticated-wallet or on-chain tests.
- The browser harness runs with `npx playwright test -c e2e/risk-components.config.ts`. It compiles local styles/components using installed dependencies; an existing Chromium executable can be supplied through `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Artifacts go to ignored `ci-artifacts/risk-components/`.
- TypeScript and formatting checks passed. `npm run lint` still fails because the installed Next version interprets `next lint` as a nonexistent project directory; lint configuration is unchanged.
- Pending cards and MCP are not covered by this integration. Phase 6 still owns full-app, co-signer and controlled preprod acceptance and release validation. No deployment or chain transaction was performed.

## Phase 4 — Independent review for pending co-signers

**Depends on:** Phases 1 and 3. **Deliverable:** all pending transactions receive the same review before signing.

- [ ] Integrate a visible risk summary beside `CollateralReview` in `transaction-card.tsx`, outside collapsed transaction details. Include transactions created through API, import, legacy UI or MCP, not only the canvas builder.
- [ ] Assess `transaction.txCbor` independently. Descriptions and `txJson` may enrich labels but cannot decide which warnings apply. A mismatch must not hide an output or reduce displayed exposure.
- [ ] Gate the `signTx` path before `activeWallet.signTx`, including re-signing to supply a collateral-owner witness and the final co-signer who may trigger automatic submission.
- [ ] Require each signer to acknowledge known-dangerous outputs for the current body and account. Replacement transactions reset review; another signer's approval is not evidence of safety.
- [ ] Preserve current collateral owner/witness verification, network checks and proxy auditing. Reuse current collateral-return accounting for imported transactions rather than asserting that every pending transaction has no return.
- [ ] Cover decoding/loading errors with a retry state. Unknown contract rules still allow deliberate signing; unavailable mandatory transaction or collateral facts do not masquerade as verified review.

**Acceptance:** imported funding-only CBOR triggers the same warning without editor provenance; a second signer sees it independently; replacement/account changes invalidate acceptance; ordinary native multisig self-payments remain correctly identified.

## Phase 5 — Consistent MCP and shared review cards

**Depends on:** Phases 1 and 4. **Deliverable:** warnings survive alternate review surfaces.

- [ ] Populate structured findings and readable warnings through `src/lib/tx-review/pipeline.ts`, `preview.ts`, `propose.ts`, `review.ts` and `summary.ts`. Preserve existing summary consumers with additive fields where possible.
- [ ] Analyze completed CBOR for preview/propose, and stored CBOR for pending review. The current pending summary uses `txJson`; reconcile displayed risk-relevant outputs with CBOR so the card cannot show one destination while warning about another.
- [ ] Render warnings and affected values consistently in text, PNG (`card.ts`) and HTML (`src/lib/mcp/apps/review-card.ts`). Ensure long addresses, multiple warnings and token lists remain legible without silently truncating critical facts.
- [ ] Keep existing headless Plutus restrictions: MCP need not construct script spends to send funds to a script address or review a pending script transaction.
- [ ] Retain preview-token binding and existing authorization. Reassess after proposal rebuilds; do not carry a preview acknowledgment onto materially changed risk facts. If risk-relevant outputs/context change, require a fresh preview rather than treating ordinary input reselection warnings as sufficient.
- [ ] MCP proposal confirmation creates an unsigned pending transaction; it does not acknowledge risk for future wallet signers. Display warnings before confirmation, then independently enforce each human's signing review in Phase 4.
- [ ] Preserve lazy loading of Mesh/WASM and renderer dependencies in MCP tools, as required by repository instructions.

**Acceptance:** one fixture yields equivalent findings in builder review, pending UI, MCP text, HTML and PNG; altered/missing `txJson` cannot suppress CBOR-derived warnings. No new signing/broadcast capability is added to MCP.

## Phase 6 — Regression coverage, documentation and release

**Depends on:** Phases 2–5. **Deliverable:** verified behavior and a bounded rollout.

| Scenario                                                                  | Required result                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Known always-true recipient without datum or script inputs                | Immediate warning and final acknowledgment in all builder source modes.                                       |
| Mainnet versus preprod/preview                                            | Same hash detection; accurate network copy and stronger mainnet emphasis. No real mainnet transfers in tests. |
| Key payment credential with datum or script stake credential              | No unsupported claim that spending control moved to a script.                                                 |
| Verified current-wallet native script/change                              | No loss-of-multisig-protection warning solely for ordinary change.                                            |
| Unknown native/Plutus recipient, known proxy address                      | Honest classification without generic “unsafe” or “safe” labels; existing proxy invariants preserved.         |
| Recovering an always-true input to a key address                          | Input availability warning; no false outgoing anyone-can-spend claim.                                         |
| Multiple outputs to the same script, ADA top-ups and tokens               | Every affected output and final amount represented without merging away identity.                             |
| Edit address/amount/redeemer/collateral or switch account/network         | Review invalidates and old acceptance cannot authorize changed transaction bytes.                             |
| Cancel, pending replacement, final co-signer, one-approval wallet         | No wallet signature before current review; replacement does not inherit acknowledgments.                      |
| Imported CBOR, absent or misleading `txJson`, unsupported editor features | Review remains CBOR-based; malformed data has an explicit error state.                                        |
| Collateral spent/unavailable, missing owner witness, recorded return      | Existing refusal/readiness behavior preserved and exposure correctly displayed.                               |
| Provider/evaluator failure                                                | No success/safety implication; required verification failures block the affected action.                      |
| Mobile, keyboard and screen-reader use                                    | Warnings remain discoverable, acknowledgments labelled and cancel/focus behavior usable.                      |

- [ ] Extend focused Jest coverage around draft outputs, Plutus inputs, collateral, builder/store invalidation and transaction review. Add pure classifier tests and integration tests with real serialized fixtures; avoid testing only mocked risk results.
- [ ] Extend the existing builder Playwright fixtures and add pending/co-signer tests with wallet-sign/submit call assertions. Use mocked chain data for mainnet cases.
- [ ] Run focused suites, `npm run typecheck`, relevant browser tests and repository-required checks; run broader regressions for the shared signing/review changes. Check formatting of changed files. Record any baseline tool/configuration failures explicitly rather than treating a skipped check as passing.
- [ ] Update the preprod guide to explain the shared address, loss of multisig protection after funding, each tester's own output reference, and expected UI warnings. Update builder/pending and MCP documentation where behavior changed.
- [ ] Run the existing offline fixture, then a controlled preprod funding/spending/replacement/co-signing exercise with small disposable test ADA. Record actual transaction hashes and distinguish offline results from chain acceptance. Do not test loss scenarios with valuable assets.
- [ ] Release browser creation and co-signing coverage together; do not declare the guardrails complete while pending signers lack them. Include MCP parity before claiming coverage across all review surfaces.

**Acceptance:** the matrix passes with recorded evidence; docs match visible behavior; warnings do not imply general contract auditing. No new database or protocol migration is needed for the proposed first release.

## Suggested implementation sequence

1. Phase 0 decisions and Phase 1 shared assessment, with fixtures/tests.
2. Phases 2–3 builder feedback and signing/export review.
3. Phase 4 pending co-signer integration before enabling the complete browser flow.
4. Phase 5 MCP/card parity, followed by Phase 6 release validation and documentation.

Keep behavior switches, if needed for staged development, explicit and consistent across creation and signing surfaces. The maintainer authorized phases 0–3 and the related vault documentation on 2026-10-21. Phases 4–6, deployment and on-chain test transactions remain future work.
