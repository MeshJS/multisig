# Plutus Transaction Controls Implementation Plan

Status: Phases 1–6 implemented. Browser verification, upstream PRD reconciliation, and controlled preprod acceptance remain pending; Phase 7 remains planned.

Owner: Andre  
Suggested branch: `feat/plutus-transaction-controls`  
Prepared: 2026-10-05

## Goal and scope

Extend the existing transaction builder so users can attach validated inline datums to individual outputs and configure Plutus script spends with a script, datum source, redeemer, and connected-signer collateral. Preserve these associations while editing drafts and encode the complete script data in the unsigned transaction.

Use the agreed interface:

| Location | Controls |
| --- | --- |
| Selected output → Advanced → Inline datum | Enable, edit, validate, preview, and remove that output's datum. |
| Transaction → Advanced → Script inputs | Add and configure each Plutus input by its UTxO reference. |
| Transaction → Advanced → Collateral | Choose one eligible ADA-only UTxO supplied by the connected signer; show its owner and amount at risk. |

Advanced starts collapsed for an unconfigured draft. Configured sections retain visible summaries, and output cards display a datum badge. Blocking errors, collateral exposure, and missing collateral-owner signatures remain visible in review regardless of collapsed sections.

Automatic collateral creation, reservation, and collateral-return management remain in **#221**. Also exclude new minting, Plutus staking/voting controls, a contract IDE, automatic contract parameter application, and a general reference-script management interface. Preserve existing supported staking and voting behavior.

This document is an implementation plan based on the supplied scope and repository inspection. It does not replace a vault PRD. No feature-specific PRD was identified in the inspected repository notes; Phase 0 reconciles the plan with the upstream PRD before implementation.

## Existing code to reuse

Paths below are relative to the repository root.

| Area | Existing code | Planned reuse |
| --- | --- | --- |
| Editable intent | `src/types/tx-draft.ts`, `src/lib/tx-draft/mutations.ts`, `src/lib/zustand/tx-builder.ts` | Extend the draft and pure mutation functions; keep Zustand as their thin UI wrapper. |
| Validation | `src/lib/tx-draft/validate.ts`, builder `problems-panel.tsx` and inspector `issue-list.tsx` | Add field-specific issue codes and input references to the existing issue model. |
| Inspector UI | `src/components/pages/wallet/build/inspector/output-inspector.tsx`, `tx-inspector.tsx` | Add contextual Advanced sections using existing form controls and Radix Collapsible components. |
| Canvas | `src/components/pages/wallet/build/builder-canvas.tsx`, `src/utils/token-flow/from-draft.ts` | Extend the current projection, selection, and badges without creating a second canvas. |
| Building | `src/lib/tx-draft/to-tx-builder.ts`, `build-draft-tx.ts` | Apply the new intent through the existing build pipeline. |
| Provider and evaluation | `src/utils/get-tx-builder.ts`, `src/lib/completeTxWithFreshCostModels.ts` | Reuse the configured fetcher/evaluator, network selection, and current cost-model handling. |
| Plutus patterns | `src/lib/proxy/txBuilders.ts` | Reuse established per-input Mesh call ordering; extract small shared helpers only when both callers benefit. |
| Wallet and UTxOs | `src/hooks/useActiveWallet.ts`, `useAddressUtxos.ts`, `useAvailableUtxos.ts`, `src/lib/server/proxyUtxos.ts` | Reuse wallet access and chain resolution patterns; separate generic collateral checks from proxy-specific policy. |
| Pending editing | `src/lib/tx-draft/from-tx-json.ts`, builder `load-pending-dialog.tsx`, `replace-confirm-dialog.tsx` | Extend compatibility and loading deliberately; preserve the existing replacement/signature-reset flow. |
| Signing | `src/hooks/useTransaction.ts`, `useSignAndSubmit.ts`, `src/utils/txSignUtils.ts`, `txScriptRecovery.ts` | Extend witness retention and submission readiness centrally. |
| Tests | `src/__tests__/txDraft*.test.ts`, `txBuilderStore.test.ts`, `completeTxWithFreshCostModels.test.ts`, `src/__tests__/tx-builders/` | Extend established fixtures, real builder tests, and provider injection. |

Prefer installed Mesh packages (`@meshsdk/core`, `core-cst`, `core-csl`, provider/react integrations), Zod, Zustand, React Query, existing UI primitives, Jest, and Playwright. No new runtime dependency or SDK upgrade is planned. Verify exact APIs against the installed packages and lockfile before using examples from newer documentation.

Mesh already supplies datum/redeemer encoding and transaction-builder methods, including `txOutInlineDatumValue`, `txInDatumValue`, `txInRedeemerValue`, versioned Plutus spending methods, and `txInCollateral`. Use these through a small application adapter rather than implementing CBOR or script serialization. See [Mesh data formats](https://meshjs.dev/apis/data/overview) and [Mesh smart-contract transactions](https://meshjs.dev/apis/txbuilder/smart-contracts).

## Findings that affect the design

- `DraftOutput` already has a stable ID, but contains only address/assets. Attach datum intent to that ID, never to an address or array position.
- Canvas selection currently resolves some placed outputs by address. Multiple outputs to the same address must remain individually selectable when they carry different datums.
- The draft store is currently in memory. Preserve data through edits and pending-transaction reloads; browser-refresh persistence is not an implicit addition to this scope.
- `isDraftCompatible` currently rejects output datums, Plutus inputs, collateral, reference inputs, and additional required signers. Removing these checks before implementing lossless reconstruction would silently discard transaction semantics.
- Pending loading currently strips trailing outputs using the change address. That heuristic must not remove an intentional datum-bearing output sent to the same address.
- `applyDraftToTxBuilder` applies one funding-source witness mode to every selected input. Explicit Plutus inputs need their own per-input handling alongside existing funding inputs.
- `assets.ts` uses a fixed token-output ADA floor. Datum size requires SDK-backed minimum-output validation during completion; the existing floor is not a sufficient estimate.
- `filterWitnessesToScripts` keeps keys referenced by native scripts. The collateral owner's payment key may be different, including another payment key in the same connected wallet.
- Submission decisions currently use wallet threshold/address-count logic in several paths. A satisfied multisig threshold alone must not make a transaction ready when its collateral-owner witness is missing.
- Proxy collateral resolution currently enforces a 5 ADA policy. Do not copy that value as a universal protocol requirement; use current parameters and the evaluated fee for sufficiency.
- `submitDatum.ts` handles signable payloads. Its name does not make it a reusable Plutus-data validator.

## Phase 0 — Confirm the implementation contract

**Outcome:** a bounded, testable feature contract before changing runtime code.

- [ ] Read the upstream PRD and linked concept/entity notes when available; record the PRD ID and reconcile differences. Implementing PRs should cite that ID, as required by `.agents/README.md`.
- [ ] Verify installed Mesh data codecs, supported script versions, evaluator behavior, transaction-body shapes, and signer APIs. Record supported language/feature combinations rather than assuming every version supports every datum mode.
- [ ] Default to supplied, already-parameterized script CBOR plus an explicit Plutus version. Defer reference-script selection unless the PRD requires it.
- [ ] Support datum sources explicitly: inline datum from the resolved input, or a supplied datum whose hash matches the resolved input's datum hash. Confirm any supported datum-less behavior per language; never invent a missing datum.
- [ ] Use CBOR hex as the lossless baseline for data entry/storage. Add structured Plutus JSON using existing codecs only if integer precision is preserved; reject unsafe numeric values instead of rounding them. Keep arbitrary JSON and Plutus data distinct.
- [ ] Record the supported behavior for each current funding mode: multisig proposal, connected-wallet sign/submit, and address-source unsigned export. Script spends require a connected collateral supplier even when exporting unsigned transactions. Unsupported combinations must explain why they are blocked.
- [ ] Confirm how proposer authorization and collateral ownership interact. Preserve existing wallet membership rules; do not grant proposal/signing authorization merely because a wallet supplies collateral.
- [ ] Define the current-month collateral policy: one existing ADA-only key-controlled UTxO, no split transaction, reservation, or return management. Verify emitted collateral fields and the exposure they imply.

**Acceptance:** documented decisions, representative fixtures, and a PRD reference or explicitly recorded missing-spec dependency. No claims of universal arbitrary-contract support: contracts needing controls outside this scope should produce a clear limitation or evaluation error.

## Phase 1 — Extend draft intent and shared data validation

**Depends on:** Phase 0.

- [x] Add optional inline-datum intent to `DraftOutput`; extend `TxDraft` with explicit script inputs and collateral selection. Existing drafts default to empty/unconfigured fields.
- [x] Identify script inputs by transaction hash/output index, with stable UI identity. Store script version/CBOR, datum-source choice, and redeemer on that input.
- [x] Keep user-entered text and validation state distinct from validated data. An invalid edit must block building rather than reuse an earlier valid value. Avoid persisting derived evaluator budgets as editable intent.
- [x] Add one shared Plutus-data adapter for datum and redeemer parsing, SDK encoding/decoding, and readable errors. Reuse Zod for application shape validation and SDK codecs for ledger data validation.
- [x] Extend pure mutations and the store for set/remove datum, add/update/remove script input, and set/clear collateral. Preserve unrelated values on address, asset, description, and canvas edits.
- [x] Extend `DraftIssue` with an input reference/ID and field where needed. Route errors through existing inspector/problem components.
- [x] Define source, account, network, and wallet changes: preserve editable intent where valid, invalidate stale resolved UTxOs/collateral/build results, and require revalidation. Removing the last script input removes unused collateral requirements.

**Acceptance:** mutation/store tests prove association stability, backward-compatible empty defaults, invalid-edit blocking, and correct clearing/revalidation. Codec tests cover constructors, lists, maps, bytes, integers, malformed CBOR/JSON, and values above JavaScript's safe integer range.

### Phase 1 implementation notes

- Implemented against this agreed plan; Phase 0's upstream PRD reconciliation remains pending. No contract execution or on-chain compatibility claim is introduced by the draft types.
- `plutus-data.ts` derives validated CBOR and a JSON preview from current raw text using the installed Mesh CST/CSL codecs and Zod. JSON integers outside the safe-number range must use quoted decimal strings. Decimal/exponent numeric tokens are rejected before parsing to prevent rounding. CBOR is accepted only when the ledger codec can round-trip it byte-for-byte, rejecting trailing data and unsupported encodings.
- Script/collateral draft fields hold references and user intent, not resolved UTxO snapshots or evaluator budgets. Source/account/network changes clear funding selections and collateral; script references and text remain for fresh resolution in later phases. Changing the multisig wallet resets the draft.
- Local errors carry output/input IDs, input references, and fields through existing problem/inspector components. Script version/hex checks are structural only; script hash, ownership, datum-hash, and execution checks remain in subsequent phases.
- Both validation and the transaction builder explicitly reject advanced intent until later phases encode it. This prevents valid or invalid new fields from being silently omitted; the new Advanced editors are not exposed yet.
- Verification: focused draft/store/canvas tests passed, TypeScript passed, and the full CJS/ESM suite passed (1,658 tests; two existing skips). ESLint could not initialize because the repository's current compatibility configuration reports a circular React plugin structure; no lint-config changes were included.

## Phase 2 — Deliver output inline datums end to end

**Depends on:** Phase 1. This is the first independently reviewable feature slice.

- [x] Add the output Advanced section with enable/remove actions, format selection where supported, validation, and a decoded preview. Reuse the same editor later for redeemers and supplied input datums.
- [x] Extend the output loop in `applyDraftToTxBuilder`: attach each inline datum immediately after its corresponding `txOut` call using Mesh's explicit data-format argument.
- [x] Preserve distinct outputs with identical addresses. Update builder-specific node/edge selection to use output IDs, and audit duplicate-output validation without changing unrelated transaction-viewer behavior.
- [x] Display a datum badge and expand/focus the appropriate editor when a user follows a validation issue.
- [x] Use SDK completion to account for datum-dependent minimum ADA and transaction size; show the resulting requirement or adjustment before signing. Do not rely solely on the current token-only floor.
- [x] Enable pending reload for the supported inline-output-datum subset only. Preserve datum-bearing self-outputs and separate intended outputs from generated change using reliable provenance where available; retain ambiguous legacy outputs with a warning instead of discarding them.
- [x] Preserve unsupported output datum/reference-script forms behind explicit compatibility errors until they have a tested representation.

**Acceptance:** decoded unsigned CBOR contains each datum on the correct output. Tests cover two outputs to one address with different datums, add/remove/reorder/address edits, self-outputs, load/edit/rebuild, and ordinary transfers without datums. Output datums alone do not activate collateral requirements.

### Phase 2 implementation notes

- The reusable `PlutusDataEditor` uses Phase 1's codec for CBOR/Plutus JSON validation, format conversion, and decoded previews. Output cards and edges use stable output IDs, including repeated addresses and self-payments. Datum issues open and focus the associated editor.
- Output datums now pass the build gate; script inputs and collateral remain blocked until subsequent phases. No new dependency or database migration was added.
- The installed Mesh SDK's `complete()` does not raise an explicitly undersized ADA amount. The adapter therefore calls Mesh's `calculateMinLovelaceForOutput` with the datum before selecting funding inputs. Datum builds fetch current protocol parameters; completion checks transaction size. Draft amounts stay unchanged, while build results and a required pre-sign review show final ADA amounts and adjustments. Cancelling or changing the draft cancels review; accepting signs the same completed bytes.
- Builder proposals store versioned output IDs and finalized-output fingerprints in existing `txJsonExtras`. Reload checks these against the body before excluding generated change. Missing or mismatched provenance retains all outputs and displays a warning. Hash/embedded datums, unsupported data encodings, malformed outputs, and reference scripts remain incompatible.
- Real SDK tests decode unsigned CBOR and cover distinct same-address datums, self-payments, minimum ADA and size limits, edit/reorder/remove/load/rebuild, and absence of collateral/signatures. Hook tests verify cancellation and signing only after acceptance of the finalized transaction.
- Verification: TypeScript and the full CJS/ESM suite passed (1,670 tests; two existing skips). ESLint still cannot initialize because the repository's compatibility configuration reports a circular React plugin structure.
- A Playwright test covers independent editors, format conversion, validation focus, and datum removal. Execution is pending: the existing browser harness requires `CI_CONTEXT_PATH`, which is not configured in this checkout. No on-chain acceptance transaction was attempted.

## Phase 3 — Resolve and configure Plutus inputs

**Depends on:** Phase 1; reuse Phase 2's editor.

- [x] Add Transaction → Advanced → Script inputs. Resolve a supplied UTxO reference through the existing provider, then show its address, assets, datum information, and configuration.
- [x] Validate the on-chain payment script hash against the supplied script and language using Mesh helpers. Check network, reference shape, live availability, and duplicate input references.
- [x] Support the agreed inline/supplied datum-source modes. Read inline data from the resolved UTxO; validate supplied datum hashes against chain data. Do not trust pasted amounts, addresses, or datum hashes as chain truth.
- [x] Require a valid redeemer for each supported spend and attach errors to that input. Distinguish data-format validity from successful contract evaluation.
- [x] Extend funding calculations to include explicit script-input value once, then select only the remaining needed funding inputs. Preserve current manual-selection semantics.
- [x] Keep Plutus inputs separate from automatic native-script/pubkey funding selection. Enforce the product policy that collateral is not also selected as a normal input, and keep reference inputs distinct if subsequently supported.
- [x] Revalidate resolved data after draft/source/account/network changes; reject stale async results for a superseded draft.
- [x] Connect fresh resolution immediately before Plutus completion in Phase 5. UI snapshots never become build inputs; headless script-spend callers remain explicitly blocked.

**Acceptance:** mixed native-script/pubkey funding and Plutus spending can be represented without misclassifying inputs or counting funds twice. Tests cover duplicate refs, mismatched script/datum hashes, spent inputs, unsupported versions, and stale resolution results.

### Phase 3 implementation notes

- Added Transaction → Advanced → Script inputs with stable input IDs, transaction hash/index fields, explicit V1/V2/V3 selection, already-parameterized script CBOR, datum-source selection, and the shared datum/redeemer editor. Chain address, exact asset quantities, datum information, decoded inline data, per-input issues, and a recheck action are shown. Problem links reopen Advanced and focus the input field. Resolved script tokens are available in the output asset picker.
- `resolve-script-inputs.ts` uses the installed Mesh script/data hashing helpers. Blockfrost's `fetchUTxOs` returns historical transaction outputs, including spent outputs, so resolution additionally finds the exact reference in `fetchAddressUTxOs`. Only the live result supplies address, amounts, and datum data. Provider failures, missing/spent refs, network mismatches, unsupported languages, script-hash mismatches, datum-hash mismatches, and invalid redeemers are blocking input issues.
- Supported configuration: V1 with a supplied hash-matching datum; V2/V3 with either the actual inline datum or a supplied hash-matching datum. Datum-less spends and reference-script selection remain unsupported. V1 plus inline data is rejected, including inline data elsewhere in the configured transaction ([CIP-32](https://cips.cardano.org/cip/CIP-0032)). Data-format/hash validation does not claim contract evaluation success.
- The debounced resolver belongs to the exact draft and environment; edits, source/account/network changes, removal, and explicit retry immediately hide old results and reject late responses. Nothing is persisted into editable intent. Every resolver invocation performs a new live lookup, with tests for a previously resolved input becoming spent. Phase 5 must call this uncached resolver with a current-revision guard immediately before completion, as recorded above.
- Shared `funding.ts` counts explicit script value once, excludes script/collateral refs from ordinary automatic selection, and selects only remaining deficits including the existing fee headroom. Manual choices remain exact; overlaps are blocking rather than silently discarded. Existing native/pubkey builds use the same selection helper. Script value is included in the UI's sufficiency check, but Plutus encoding/proposal/sign/submit remains blocked until Phases 4–5. No new API/MCP write surface, runtime dependency, database migration, collateral creation, or witness behavior is introduced.
- Upstream PRD reconciliation remains the recorded Phase 0 dependency; this slice follows the supplied plan.
- Verification: 65 focused draft tests passed. The full CJS/ESM coverage run reported 1,690 passing tests and two existing skips; PowerShell redirected the Jest stderr summary as a `NativeCommandError`, so the wrapper returned 1 despite both suites passing. TypeScript passed. ESLint still fails while loading the existing compatibility config with a circular React plugin structure. Added Playwright coverage for configuration, chain display, issue focus, spent-input recheck, removal, and the disabled build gate; execution remains blocked because `CI_CONTEXT_PATH` is not configured. No on-chain transaction was attempted.

## Phase 4 — Add collateral selection and signature requirements

**Depends on:** Phase 3. Complete before enabling a Plutus proposal or submission.

- [x] Reuse the connected wallet integration to discover existing collateral candidates. Feature-detect collateral APIs and, where supported, use wallet-supplied UTxOs as a fallback with the same eligibility checks. The current [CIP-30 specification](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0030/README.md) marks `getCollateral` deprecated, so it must not be the sole discovery path.
- [x] Validate the chosen UTxO on chain: current network, unspent, ADA-only, key-controlled, and supplied by the connected wallet. Derive the actual payment key from the collateral output, not the wallet's displayed address or stake key.
- [x] Calculate sufficient collateral from current protocol parameters and the evaluated fee, including the maximum input-count policy. Keep proxy-specific fixed floors out of the generic helper.
- [x] Show selected reference, collateral owner, selected amount, and actual maximum exposure from the emitted transaction. Keep this summary visible in review. With no collateral return, do not describe the whole selected amount as if only the protocol minimum were at risk; verify against [CIP-40](https://cips.cardano.org/cips/cip40).
- [x] Add the collateral payment key as an explicit required signer through Mesh. Persist/reconstruct that requirement in the supported draft/transaction representation.
- [x] Extend shared witness retention to keep collateral/required-signer and other necessary key-input witnesses while preserving native-script behavior and the original body bytes. Preserve scripts, datums, redeemers, auxiliary data, and existing witnesses during merges.
- [x] Extend readiness checks so existing multisig authorization and actual verified collateral-owner witnesses must both be satisfied. Do not infer payment-key coverage from `signedAddresses` alone.
- [x] Audit creation, later co-signing, server/API signing, and immediate-submit paths: `useTransaction.ts`, transaction cards, `signTransaction.ts`, and `createPendingMultisigTransaction.ts`. Reuse one readiness helper where applicable.
- [x] A missing candidate or missing owner witness produces a specific actionable state. Account switches invalidate unsigned selections; existing pending transactions retain their recorded requirement rather than silently switching collateral owners.

**Acceptance:** tests prove a multisig threshold without the collateral witness is insufficient, the collateral witness alone is insufficient, and a collateral key outside the native-script key set survives signing. A refusal/missing wallet signature cannot mark that requirement satisfied. No creation, reservation, or return-management workflow is added.

### Phase 4 implementation notes

- Added Transaction → Advanced → Collateral with one existing wallet UTxO selection, recheck/clear actions, issue focus, and an owner/reference/amount summary that stays visible when collapsed. The editor explicitly distinguishes the full selected exposure from the minimum that can only be determined after evaluation. Output datums alone do not request collateral.
- `collateral.ts` feature-detects both Mesh `getCollateral` and `getUtxos`, tolerates an unavailable/deprecated collateral API, deduplicates results, and verifies wallet-supplied references against live address UTxOs on the selected network. Chain data supplies the ADA amount and actual payment key, including a key different from the displayed account address. No proxy-specific ADA floor is used. Drafts retain only the reference; account/network/source invalidation remains in the existing store. Debounced results belong to the exact draft, wallet instance, environment and retry attempt.
- Phase 5 must call `resolveDraftCollateral` with its current-revision guard immediately before building, then `applyCollateral` before completion, then `reviewCompletedCollateral` on the evaluated final bytes before review/signing/export. These helpers implement fresh wallet/chain checks, Mesh `txInCollateral`/`requiredSignerHash`, current protocol-parameter lookup, integer-ceiling fee sufficiency, one-input/max-count policy, emitted-reference/signer/overlap checks, and full exposure without a return. Tests exercise real Mesh CBOR and `requiredSignatures` JSON serialization. The shared Plutus build gate stays closed; this phase does not claim evaluated Plutus builds are available.
- Required signers are recorded in the immutable transaction body and the existing Mesh JSON representation. Pending review/readiness reconstructs them from CBOR and resolves the recorded collateral reference, never the currently connected account. Legacy proxy collateral without an explicit required-signer field also requires its actual owner witness. Draft editing of collateral/extra required signers remains explicitly incompatible until Phase 6 implements the full round trip.
- `transactionReadiness` combines existing wallet authorization with cryptographically verified required-key/collateral witnesses and native-script coverage for advanced transactions. Creation, browser co-signing, REST signing, server immediate creation/submission, and connected-wallet submission call it. Browser paths also require the authorized member's actual payment-key witness before recording that member as signed. Collateral ownership grants no wallet membership or API authorization. Existing API signing keeps an incomplete transaction pending; it does not gain a new signing payload or write capability.
- Shared witness filtering retains explicit/native-script keys and all verified witnesses, including other necessary key-input/staking witnesses whose owners cannot be inferred from input references alone. The API now verifies the original CST body hash and merges witnesses with CST, as do native-script recovery and witness-removal paths. Tests preserve the body hash, existing witnesses, Plutus scripts, datums, redeemers and auxiliary data. Removed the transaction card's equal-witness-count assumption; authorized members can retry signing a pending collateral transaction after a wallet omits its secondary payment key.
- Pending cards show recorded required keys, chain-resolved owner/reference/value, exposure derived from the emitted return fields, and missing-owner/chain-error states outside collapsed details. Upstream PRD reconciliation remains the recorded Phase 0 dependency. No dependency, schema change, automatic collateral creation, reservation, or return management was added.
- Verification: TypeScript passed. The full CJS/ESM coverage run passed (1,705 tests; two existing skips); the final focused collateral/serialization/witness/signing run passed all 73 tests, including an additional current-parameter/stale-review test. Browser coverage was added for wallet-UTxO fallback, keyboard selection, persistent exposure, spent recheck and removal, but execution is blocked by the existing harness's missing `CI_CONTEXT_PATH`. ESLint still fails loading the existing compatibility configuration with a circular React plugin structure. No on-chain transaction was attempted.

## Phase 5 — Build, evaluate, and review complete transactions

**Depends on:** Phases 2–4.

- [x] Extend `applyDraftToTxBuilder` with per-input Plutus version, script, datum source, and redeemer calls, plus collateral and required signers. Reuse proxy-builder patterns without importing proxy-specific contract assumptions.
- [x] Keep `buildDraftTx`, the existing provider evaluator, and `completeTxWithFreshCostModels` as the shared completion path. Refactor duplicated preparation only as needed so test-build, export, proposal, and direct-sign flows apply identical intent.
- [x] Let Mesh perform input ordering, redeemer indexing, execution-budget integration, fee calculation, and script-data hashing. Preserve the existing cost-model correction behavior and test it with the new paths.
- [x] Evaluate against the complete transaction context. Block progression on script failure, unresolved data, unavailable evaluation, insufficient collateral, or size/budget limits; do not silently supply guessed budgets or skip evaluation.
- [x] Display evaluated fees, budgets where useful, script-input summaries, output datum indicators, collateral exposure, and required-signature status in existing build/review components.
- [x] Invalidate results after edits and reject stale asynchronous completion. Sign only a successfully evaluated current transaction; if preparation/rebalancing changes it, refresh the review before signing.
- [x] Verify build/export remains unsigned and does not propose, sign, or submit. Extend shared helpers without exposing new MCP/API write capabilities automatically; unsupported headless inputs remain explicitly rejected.

**Acceptance:** real SDK serialization plus decoded-CBOR assertions verify script inputs, datums, redeemers, collateral, required signers, and script-data hash. Fixture tests include multiple redeemers whose input order changes, provider failure, and an evaluation rejection. A successful real evaluation is required in final preprod acceptance, not inferred from mocks.

### Phase 5 implementation notes

- All browser actions now call the same `buildDraftTx` path with a fresh builder. `prepare-plutus.ts` performs uncached script-input and connected-wallet collateral resolution immediately before encoding, fetches current protocol parameters, and rejects stale results. The adapter accepts resolver-created preparation only; UI snapshots and caller-supplied amounts cannot enable Plutus encoding. Ordinary native-script/pubkey funding remains separate and counts explicit script value once.
- Per-input Mesh calls encode supplied, already-parameterized V1/V2/V3 script CBOR, the chosen datum source, and CBOR redeemers. Supported combinations remain V1 with a hash-matching supplied datum, and V2/V3 with inline or hash-matching supplied data. V1 with inline data elsewhere in the transaction is blocked, including automatically selected funding inputs. Datum-less spending, reference-script selection, and Plutus minting/staking/voting controls remain outside scope.
- The installed Mesh builder evaluates during fee balancing. `evaluate-plutus.ts` wraps its configured evaluator to require one valid result for every emitted spending redeemer, rejecting unavailable, partial, duplicate, negative, unsafe, or failing evaluations. Mesh retains responsibility for sorting inputs, assigning indexes, integrating execution budgets and balancing fees. After `completeTxWithFreshCostModels` corrects the script-data hash, the pipeline evaluates those exact final bytes again and rejects budgets larger than the allocation; it never silently substitutes defaults or signs a changed transaction.
- Final checks use current protocol limits, Mesh's size estimate including required witnesses and fee calculation, plus `reviewCompletedCollateral` on the emitted CBOR. They enforce the single selected collateral reference, its required payment key, no overlapping inputs or collateral return, fee-based sufficiency, and full selected exposure. There is no generic 5 ADA collateral floor, automatic collateral creation, reservation, or return management.
- Build/export and the final signing dialog share script references, chain values, datum/redeemer data, allocated execution budgets, evaluated fee, output-datum summaries, full collateral exposure and the unsigned owner-signature requirement. All script spends require this review before signing. Proposals pass the completed bytes and body into `useTransaction` without completing or adding metadata again. Direct signing uses the same result. Revision checks cover chain resolution, evaluation, completion, review, wallet signing and readiness; edits, unmounts, source/account/wallet/network changes discard stale work. Existing member authorization and Phase 4 witness/readiness checks still apply.
- Address-source unsigned export also requires a connected collateral supplier. Build/export performs no signing, submission or persistence. Existing API/MCP callers lack the explicit Plutus build capability and remain rejected; no new write surface or runtime dependency was added. Pending Plutus editing remains incompatible until Phase 6 implements lossless reconstruction. Upstream PRD reconciliation remains the recorded Phase 0 dependency.
- Verification: real Mesh completion and decoded-CBOR fixtures cover mixed native/key funding, script-only funding, all five supported language/datum combinations, multiple redeemers with reordered inputs, witness/datums/collateral/required-signers preservation, and fresh cost-model hash correction. Failure cases cover unavailable or rejected evaluation, missing/invalid budgets, chain/provider errors, newly spent inputs, changed protocol limits/fees, insufficient collateral and stale async work. Hook tests verify exact-byte signing without recompletion, cancellation, metadata rejection after completion, and stale proposal/direct-sign prevention. Verification passed: TypeScript, the full CJS/ESM coverage run (1,742 passing tests; two existing skips), and the final focused draft/collateral/serialization/signing run (148 tests, including the final fee and skipped-evaluation guards).
- Browser coverage adds configuration, evaluated review, unsigned clipboard export, cancelled proposal review and edit invalidation. Execution remains blocked by the harness's missing `CI_CONTEXT_PATH`. ESLint still fails while loading the existing compatibility configuration with a circular React plugin structure. No on-chain transaction was attempted; fixture evaluation is mocked and does not replace Phase 7's controlled preprod acceptance.

## Phase 6 — Complete pending editing and signing round trips

**Depends on:** Phase 5.

- [x] Extend `isDraftCompatible` and `txJsonToDraft` for precisely the implemented script-input, datum, collateral, and required-signer shapes. Keep unsupported features blocked with specific reasons.
- [x] Reconstruct input-to-script/datum/redeemer relationships by UTxO reference and the stored Mesh representation, not by assuming draft order matches ledger input order.
- [x] Preserve all supported required signers. If an imported transaction has an unrepresentable extra requirement, reject editing rather than remove it.
- [x] Preserve intended output identity and datum association through stored transaction JSON. Use existing `txJsonExtras` for versioned builder provenance if needed; validate provenance against actual body outputs and do not add a database migration by default.
- [x] Resolve live inputs and collateral again on load/build. Changed account, spent collateral, or insufficient collateral prompts correction before rebuilding.
- [x] Keep the existing replacement confirmation and signature-reset behavior. Re-evaluate after edits; never carry old signatures or execution results onto a changed body.
- [x] Ensure later transaction review/co-signing shows collateral exposure and the required owner even outside the builder.

**Acceptance:** create → build → propose → load → edit → rebuild fixtures preserve supported semantics. Tests include legacy transactions without provenance, explicit self-outputs, same-address outputs, unknown input shapes, and partial-signature replacement. Witness merging preserves the transaction hash and existing script data.

### Phase 6 implementation notes

- `read-pending-inputs.ts` validates the installed Mesh representation and reconstructs each script, datum source and redeemer from its own input reference. Inline datum references must identify that same input. Supported forms remain supplied V1 scripts with provided data and supplied V2/V3 scripts with inline or provided data; CBOR and validated Plutus JSON use the existing lossless codec. Unknown/conflicting input shapes, reference scripts, missing data, invalid required-signer forms, multiple/overlapping collateral inputs, collateral-return controls and unsupported governance/script metadata are blocked explicitly.
- Pending loading separates ordinary funding references from explicit script inputs, so script value cannot also become manual funding. Loaded drafts immediately enter the existing live script/collateral hooks; every build still performs uncached chain and wallet resolution, current-parameter collateral checks and full evaluation. Stored amounts, owner addresses and execution budgets never become trusted build inputs. Script-only pending transactions no longer produce a misleading funding-reselection warning.
- Optional draft `requiredSigners` preserves all valid 28-byte key hashes from the stored body. The adapter re-emits them with Mesh, and completion checks their presence in the actual unsigned CBOR. Requirements remain through edits and account/source/collateral changes, including the previous collateral key if the user selects a new owner. They are displayed in the inspector and unsigned/final signing reviews; there is no editor that can silently drop an imported requirement. Existing pending-card review and shared co-signing readiness already verify these recorded keys and expose the actual collateral owner and full exposure independently of collapsed details.
- Reused Phase 2's version-1 `builderOutputs` provenance without a schema migration: IDs and datum association survive when finalized-output fingerprints match; missing or invalid provenance retains every legacy output and the ambiguous-change warning. Intentional self-payments and distinct outputs at one address remain separate.
- Replacement keeps the existing confirmation and known-signature-count concurrency guard. Reconstruction carries no signatures or evaluation results, and edited proposals sign only the newly evaluated bytes. Real SDK fixtures cover all five language/datum combinations, reordered stored inputs and ledger redeemers, extra required keys, same-address/self-outputs, legacy/bad provenance, malformed inputs, changed accounts, spent inputs/collateral and insufficient collateral. Signature-merge assertions preserve body hash, scripts, datums, redeemers and auxiliary data; hook coverage verifies replacement persists only the fresh proposer's signature.
- Verification passed: TypeScript, the full CJS/ESM coverage run (1,771 passing tests; two existing skips), the final focused importer/build/collateral/datum/witness/replacement run (164 tests), and `git diff --check`.
- Browser coverage extends the existing evaluated-build fixture with pending reload, live collateral recheck, redeemer editing/re-evaluation and cancellation of partial-signature replacement. Execution remains blocked by missing `CI_CONTEXT_PATH`. ESLint still fails loading the repository's existing circular React-plugin compatibility configuration. Upstream PRD reconciliation and controlled preprod acceptance remain pending; evaluation fixtures are mocked, and no on-chain transaction was attempted. No runtime dependency, database migration, API/MCP write surface, collateral creation, reservation or return-management workflow was added.

## Phase 7 — Verify the complete user flow and document delivery

**Depends on:** Phases 2–6.

- [ ] Extend relevant existing Jest suites instead of duplicating their harnesses. Add targeted fixtures for Plutus data, signing requirements, real serialization, and compatibility regressions.
- [ ] Add Playwright coverage using the existing browser setup: configure a datum, configure a script input, select collateral, fix validation errors, build/review, and reload an editable pending transaction. Include keyboard interaction and the responsive builder layout.
- [ ] Exercise normal transfers, token sends, native-script funding, existing staking/voting, source switching, pending replacement, and shared headless callers as regressions.
- [ ] Run focused tests during implementation, then `npm run typecheck`, relevant browser tests, and `npm run test:ci` before completion. Use the repository's working ESLint invocation; inspect the existing `next lint` script's compatibility with the installed Next version rather than assuming it runs.
- [ ] Run a controlled preprod acceptance transaction for each advertised datum-source/language combination using known fixtures. Confirm evaluation, owner signing, co-signing, and resulting chain outputs; retain a small reproducible record. Do not use mainnet for acceptance testing.
- [ ] Update builder documentation and the feature/roadmap references with actual supported modes and limitations. Cite the upstream PRD in implementation PRs. Update API/MCP documentation only if their existing contracts change.

**Acceptance:** all advertised scenarios pass, no silent field loss or signature loss remains, and deferred #221 functionality is clearly distinguished from manual collateral selection.

## Suggested delivery sequence

| Delivery | Included phases | Review focus |
| --- | --- | --- |
| 1. Contract and draft foundation | 0–1 | Scope, supported formats, stable associations, reusable validation. |
| 2. Output datums | 2 | Independent usable slice, CBOR correctness, safe pending reload. |
| 3. Script inputs and collateral foundation | 3–4 | Chain validation, ownership, witnesses, shared signing behavior. Keep unfinished submission controls unavailable. |
| 4. Evaluated script spends | 5–6 | End-to-end building, review, pending editing, and co-signing. |
| 5. Acceptance and delivery | 7 | Regression evidence, preprod results, documentation. |

Tests and acceptance checks belong with each delivery; Phase 7 integrates the complete flow. This is a dependency sequence, not a calendar estimate. SDK compatibility, witness handling, and reliable pending reconstruction are the main uncertainties to resolve early.

## Definition of done

- Every configured output retains its own validated inline datum through supported edits and unsigned transaction generation.
- Every configured script input retains its script, datum source, and redeemer and successfully evaluates in the supported flow.
- Collateral comes from an eligible existing UTxO supplied by the connected signer, its exposure is visible, and its actual payment-key witness is required and preserved.
- Draft loading, review, signing, and rebuilding preserve all supported transaction semantics; unsupported semantics fail explicitly.
- Existing transaction flows pass regression checks, shared code and installed libraries are reused, and #221 remains outside this implementation.
