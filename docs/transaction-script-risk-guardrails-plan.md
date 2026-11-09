# Transaction script risk guardrails implementation plan

Status: Phases 0–6 complete under the revised scope. Regression, full-app and controlled preprod checks passed, with the historical V2-inline run and subsequent five-case matrix recorded separately in the [release evidence record](transaction-script-risk-release.md). The [gap-remediation plan](plutus-transaction-controls-gap-plan.md) records the integrated fixes and local release checks. The maintainer removed human accessibility and deployment/rollback completion gates on 2026-10-27; they were not performed. Do not infer chain acceptance from offline or mocked-browser results.

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

- [x] Integrate a visible risk summary beside `CollateralReview` in `transaction-card.tsx`, outside collapsed transaction details. Include transactions created through API, import, legacy UI or MCP, not only the canvas builder.
- [x] Assess `transaction.txCbor` independently. Descriptions and `txJson` may enrich labels but cannot decide which warnings apply. A mismatch must not hide an output or reduce displayed exposure.
- [x] Gate the `signTx` path before `activeWallet.signTx`, including re-signing to supply a collateral-owner witness and the final co-signer who may trigger automatic submission.
- [x] Require each signer to acknowledge known-dangerous outputs for the current body and account. Replacement transactions reset review; another signer's approval is not evidence of safety.
- [x] Preserve current collateral owner/witness verification, network checks and proxy auditing. Reuse current collateral-return accounting for imported transactions rather than asserting that every pending transaction has no return.
- [x] Cover decoding/loading errors with a retry state. Unknown contract rules still allow deliberate signing; unavailable mandatory transaction or collateral facts do not masquerade as verified review.

**Acceptance:** imported funding-only CBOR triggers the same warning without editor provenance; a second signer sees it independently; replacement/account changes invalidate acceptance; ordinary native multisig self-payments remain correctly identified.

### Phase 4 implementation notes

- Pending cards assess stored CBOR independently of proposal origin, editor compatibility, descriptions and JSON. Their output list and token-flow output destinations/amounts now use decoded outputs, preserving duplicate outputs and exact token base units. Missing or malformed JSON no longer prevents CBOR review.
- The visible summary sits beside collateral review, outside collapsed details. Loading and incomplete assessments remain explicit, preserve outgoing warnings and offer retry. Collateral presentation includes recorded return amount/destination, owner and maximum exposure; readiness and owner-witness checks remain in place.
- Every signing attempt refreshes mandatory spending-input and collateral facts, then requests an independent decision for script risks. Known anyone-can-spend outputs require an unchecked acknowledgment; unknown rules remain usable. Facts are refreshed again after confirmation; changed facts require a new review attempt.
- Review is bound to the body hash, assessment version, selected network, wallet/script context, account, connected wallet instance and pending row. Replacement/context changes or unmounting cancel outstanding decisions. Witness additions alone do not change that identity. No acknowledgment is persisted or inherited from another signer.
- The existing proxy audit still runs before the wallet prompt. Currentness is checked after the audit, review, wallet signature and readiness lookup, before any automatic submission. Collateral-owner re-signing and the final co-signer use the same gate.
- Verification on 2026-10-22: 226 Jest tests passed across 12 suites (the 224-test regression run plus two additional pending-card cases), including real-CBOR pending guard tests and the production pending-card signing path with mocked external boundaries. All 12 isolated browser tests passed, covering pending independent signers, cancellation, account/wallet/network/replacement invalidation, witness-only updates, retries, unknown rules and mobile/keyboard acknowledgment, alongside the existing builder checks. These are not authenticated full-app or on-chain acceptance tests.
- TypeScript and changed-file formatting checks passed. Lint remains blocked by the existing `next lint`/Next version mismatch. The browser suite used an installed Chromium executable via `PLAYWRIGHT_CHROMIUM_EXECUTABLE` because the default Playwright headless-shell binary was absent.
- Phase 4 was authorized on 2026-10-22. MCP parity, deployment and controlled preprod testing remain outside this implementation.

## Phase 5 — Consistent MCP and shared review cards

**Depends on:** Phases 1 and 4. **Deliverable:** warnings survive alternate review surfaces.

- [x] Populate structured findings and readable warnings through `src/lib/tx-review/pipeline.ts`, `preview.ts`, `propose.ts`, `review.ts` and `summary.ts`. Preserve existing summary consumers with additive fields where possible.
- [x] Analyze completed CBOR for preview/propose, and stored CBOR for pending review. The current pending summary uses `txJson`; reconcile displayed risk-relevant outputs with CBOR so the card cannot show one destination while warning about another.
- [x] Render warnings and affected values consistently in text, PNG (`card.ts`) and HTML (`src/lib/mcp/apps/review-card.ts`). Ensure long addresses, multiple warnings and token lists remain legible without silently truncating critical facts.
- [x] Keep existing headless Plutus restrictions: MCP need not construct script spends to send funds to a script address or review a pending script transaction.
- [x] Retain preview-token binding and existing authorization. Reassess after proposal rebuilds; do not carry a preview acknowledgment onto materially changed risk facts. If risk-relevant outputs/context change, require a fresh preview rather than treating ordinary input reselection warnings as sufficient.
- [x] MCP proposal confirmation creates an unsigned pending transaction; it does not acknowledge risk for future wallet signers. Display warnings before confirmation, then independently enforce each human's signing review in Phase 4.
- [x] Preserve lazy loading of Mesh/WASM and renderer dependencies in MCP tools, as required by repository instructions.

**Acceptance:** one fixture yields equivalent findings in builder review, pending UI, MCP text, HTML and PNG; altered/missing `txJson` cannot suppress CBOR-derived warnings. No new signing/broadcast capability is added to MCP.

### Phase 5 implementation notes

- MCP preview and proposal builds assess completed CBOR against the authorized free-UTxO handler's fresh chain facts. Pending review and idempotent proposal replay resolve live spending/collateral facts independently. Missing mandatory facts retain outgoing warnings in an incomplete pending review; incomplete builds cannot mint a preview token or create a proposal.
- Summaries add `riskAssessment` and preserve the existing `warnings` array. Output destinations, ledger indexes, exact asset quantities, fee, input references and body hash come from CBOR. Stored JSON cannot supply a trusted change address or hide self-payments; unrelated action metadata remains outside this script-risk assessment's scope. Input totals without independently supplied amounts are explicitly unresolved.
- Draft tokens carry a signed risk fingerprint covering assessment version, network, native wallet context, payment outputs, other non-wallet outputs, input risks and collateral. Ordinary native input reselection and verified wallet change may vary; changed exposure or context returns `REVIEW_CHANGED` and requires a fresh preview. Tokens from before this integration also require a fresh preview. No signer acknowledgment is stored or inherited.
- Text and inline HTML show full affected addresses, exact token units/quantities, output identities, mainnet wording and collateral owner/return/exposure details. Image delivery attaches a summary PNG plus bounded warning-detail pages; every page is returned, with a pointer on the summary and in text. The inline view uses selectable structured text for assessed transactions even when PNGs accompany the tool result.
- Legacy wallet payment-script selection now matches the authoritative server-derived address instead of assuming the browser-derived encoding matches it. The classifier still validates the selected script/address pair. Existing signer/bot access, zero initial signatures, headless Plutus restrictions and lazy MCP handler/renderer imports remain unchanged.
- Verification on 2026-10-22: 227 tests passed across 18 focused Jest suites, plus two real PNG-rendering tests in the ESM suite. All 13 browser tests passed, including the production MCP inline view on mobile, full warning values, escaped labels, image-mode parity and unsigned confirmation, alongside builder/pending regression checks. TypeScript, changed-file formatting and diff checks passed. Lint still fails on the existing `next lint`/Next version mismatch. The new integration tests use real serialized CBOR with mocked builder/chain/persistence boundaries; these checks do not establish full authenticated-wallet or on-chain acceptance.
- Phase 5 was authorized on 2026-10-22. Deployment and controlled preprod transactions remain phase 6 work.

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

- [x] Extend focused Jest coverage around draft outputs, Plutus inputs, collateral, builder/store invalidation and transaction review. Add pure classifier tests and integration tests with real serialized fixtures; avoid testing only mocked risk results.
- [x] Extend the existing builder Playwright fixtures and add pending/co-signer tests with wallet-sign/submit call assertions. Use mocked chain data for mainnet cases.
- [x] Run focused suites, `npm run typecheck`, relevant browser tests and repository-required checks; run broader regressions for the shared signing/review changes. Check formatting of changed files. Record any baseline tool/configuration failures explicitly rather than treating a skipped check as passing.
- [x] Update the preprod guide to explain the shared address, loss of multisig protection after funding, each tester's own output reference, and expected UI warnings. Update builder/pending and MCP documentation where behavior changed.
- [x] Run the existing offline fixture, then a controlled preprod funding/spending/replacement/co-signing exercise with small disposable test ADA. Record actual transaction hashes and distinguish offline results from chain acceptance. Do not test loss scenarios with valuable assets.
- [x] Integrate browser creation, pending co-signing and MCP coverage together. Local checks verify all three surfaces; deployment evidence is outside the revised completion scope.

**Acceptance:** the matrix passes with recorded evidence; docs match visible behavior; warnings do not imply general contract auditing. No new database or protocol migration is needed for the proposed first release.

### Phase 6 implementation notes

- Added store-backed review invalidation tests for recipient, amount, datum,
  redeemer, collateral, source, account, network and replacement edits, using real
  serialized transaction assessment. Pending-cache regression tests ensure changed
  CBOR reaches the card even when the stored hash and signer list do not change.
- Accessibility regression tests exposed missing focus restoration in both async
  dialogs. Callers now capture the invoking control before asynchronous work and
  restore it on cancellation; accessible names, checkbox labels and focus trapping
  are also checked in Chromium.
- Full-app coverage uses the existing authenticated fixtures for all three builder
  sources and imported pending review by independent signers. Chain responses are
  synthetic and wallet signing rejects after acknowledgment. Existing Plutus
  browser tests now exercise the shared export/signing dialog and fresh chain reads.
- A separate opt-in `transaction-risk-preprod.spec.ts` automates the controlled
  5 test ADA funding, 2 test ADA collateral, replacement and co-signing exercise.
  It records partial progress and actual hashes for recovery after interruption;
  it is skipped in normal regression runs. The controlled exercise passed on
  2026-10-23: 5 test ADA funded, redeemer `01` proposal replaced by `02`, second
  signer independently reviewed, and recovery confirmed on chain. The 2 test ADA
  collateral remained unspent. Retries reused the original funding output.
- Live testing exposed a CIP-30 fixture returning Mesh objects instead of CBOR;
  corrected serialization has two real-codec regression tests. All eight full-app
  scenarios passed again after that correction. Full Jest regression passed
  1,948 tests, the additional wallet-fixture suite passed two, and isolated
  Chromium passed 15. TypeScript, formatting and production build passed; lint
  retains its documented baseline configuration failure.
- See [release evidence](transaction-script-risk-release.md) for exact check
  results, baseline failures and the waived external checks. Builder, pending and MCP
  must ship together. No new schema/protocol migration or mainnet test transfer.

## Suggested implementation sequence

1. Phase 0 decisions and Phase 1 shared assessment, with fixtures/tests.
2. Phases 2–3 builder feedback and signing/export review.
3. Phase 4 pending co-signer integration before enabling the complete browser flow.
4. Phase 5 MCP/card parity, followed by Phase 6 release validation and documentation.

Keep behavior switches, if needed for staged development, explicit and consistent across creation and signing surfaces. The maintainer authorized phases 0–3 and the related vault documentation on 2026-10-21, phases 4–5 on 2026-10-22, and phase 6 on 2026-10-23. Release status and actual chain acceptance are recorded separately in the release evidence record.
