# Script-risk assessment contract

This module implements the assessment and review policy from the
[guardrails plan](../../../docs/transaction-script-risk-guardrails-plan.md) and
[gap-remediation plan](../../../docs/plutus-transaction-controls-gap-plan.md), under
the vault ID [Plutus Transaction Controls](../../../vault/features/Plutus%20Transaction%20Controls.md).
The maintainer's October roadmap tasks and the agreed risk-policy table are the
local scope. No numbered upstream PRD or GitHub issue was supplied. #221 remains
the separate automatic collateral-management work.

## APIs and trust boundaries

- `classifyPaymentAddress(address, context)` reads the payment credential and
  returns key, verified current-wallet native script, exact known anyone-can-spend
  script, or unknown script. It throws for unsupported/malformed/wrong-network
  addresses. Unknown is a normal outcome, not a claim that the contract is unsafe.
- `assessDraftOutputRisks(draft, context)` supplies early output feedback. Its
  scope is explicitly `draft-outputs`; it is never a final signing review. It
  preserves draft output IDs, including multiple outputs with the same address.
- `assessTransactionRisks(cbor, context, facts)` is deterministic and does no I/O.
  It reads all ordinary outputs and any conditional collateral return from CBOR,
  identifies spending inputs through trusted resolved UTxOs, and reports collateral
  exposure. It neither accepts nor consults `txJson`, descriptions or contact labels.
- `resolveTransactionRisks(cbor, context, provider, isCurrent)` resolves referenced
  spending/collateral inputs through the existing `ScriptInputProvider` interface.
  It checks historical output identity against fresh unspent-address results.
  Provider errors, missing/spent inputs or a changed context produce an incomplete
  assessment while retaining output warnings. Cache lifetime is one call.
- `assessResolvedInput` checks supplied script bytes/language against the resolved
  payment hash when available. It distinguishes recovery of an anyone-can-spend
  input from creating a new exposed output; it does not evaluate scripts.
- `riskFindingsToDraftIssues` projects semantic findings into existing anchored
  warning issues. It is opt-in; the builder explicitly merges this adapter into
  its issues. Incomplete-assessment errors remain separate and block final review.

`RiskContext.walletNativeScript` must come from authoritative wallet derivation,
not transaction metadata or a user-supplied “trusted address.” Supply the expected
payment script variant used by `resolveExpectedPaymentScriptCbor` in the browser,
or the matching server wallet derivation. The module independently hashes the
native script and matches its address/network. Invalid context is reported, and
assessment falls back to generic classification so it cannot suppress danger.

`ResolvedRiskFacts.utxos` is an explicit trusted-input interface, useful for an
already completed build's verified chain results and tests. It is not a public
API payload. Pending reviews should use the live resolver, or equivalent existing
fresh verification. All spending inputs must be resolved to claim completeness;
reference inputs are not spends. This resolver is for pending/pre-sign review,
not historical review of transactions whose inputs are already spent.

Completed output indexes are authoritative. The assessment does not
attach unverified draft IDs to CBOR outputs; UI adapters must check final
output address, value and datum before correlating IDs. Minimum-ADA top-ups are
therefore reported at their final values without copying draft amounts.

## Meaning of completeness

`complete` means all facts in this module's declared scope were inspected. It does
not mean ledger validity, contract safety, signature readiness or approval to sign.
The result carries a version, scope, network ID and (for decoded transactions) body
hash. It does not carry or persist an acknowledgment.

No evaluation result is inferred from stored CBOR or script recognition. Existing
script resolution, datum/redeemer validation, evaluation, authorization, proxy
audits and `transactionReadiness` remain authoritative for their own checks.
The builder binds each decision to current transaction/context identity through
`reviewBuiltTransaction`; pending review independently applies the same completeness
and acknowledgment policy for each co-signer through `reviewPendingTransaction`.

## Supported review contract

- Supported sources: multisig proposal, connected-wallet signing, other-address
  unsigned export, replacement editing and pending review (including API/MCP/import
  origins). Builder proposal, connected signing, replacement, unsigned-copy,
  pending/co-signer and MCP integration is implemented.
- Shelley base, enterprise and pointer payment addresses are inspected. Reward,
  Byron and malformed address forms produce an explicit unsupported/incomplete
  result rather than a guessed payment credential. Mainnet is network 1; the
  existing site convention maps other selected networks to testnet ID 0. The
  address cannot tell preprod from preview.
- Known output danger requires explicit acknowledgment before builder actions on all
  networks. Mainnet gets stronger presentation. Unknown script outputs get visible
  review without an acknowledgment checkbox for every contract. Own-wallet native
  change and key-payment outputs with datums do not get a loss-of-control warning.
- Collateral review reuses `inspectCollateral` and the existing ADA-only policy.
  It supports multiple recorded owners and a recorded return for imported CBOR;
  selected minus returned ADA is maximum protocol collateral exposure. Return
  destination is visible separately and classified, because returned funds need
  not go back to the supplying owner. Exposure is not apportioned across owners.
  Token-bearing collateral is explicitly incomplete under current application
  support; it is never silently reduced to an ADA-only estimate.
- No editor compatibility test is required. Reference inputs, datums, other
  transaction fields and collateral return are retained in the original bytes.
  This scope does not audit minting, certificates, governance, reference-script
  publication or other unrelated ledger actions. Signing checks remain required.

## Verified codec behavior and fixtures

Implementation was checked against the installed and locked Mesh core/core-csl
1.9.1 APIs. `@meshsdk/core-csl` exposes whisky's CSL wrapper; browser builds use
its existing browser mapping. No new dependency or SDK upgrade is required.

Two codec details are covered by regression tests:

1. The installed `Address.payment_cred()` also returns a credential for reward
   addresses. Checking the address kind first is necessary to distinguish payment
   control from staking control.
2. `Transaction.from_hex()` accepts trailing bytes. A Mesh-exported
   `Serialization.CborReader` checks that exactly one CBOR item consumes the whole
   input before CSL decoding. It does not canonicalize or rewrite the transaction
   body. Asset names use raw `AssetName.name()` bytes, not serialized CBOR hex.

`src/__tests__/fixtures/tx-risk.ts` contains deterministic public hashes and real
serialized transaction structures, never secrets or live UTxOs. It covers the
published V2 always-true hash, native/key/unknown credentials, base and enterprise
variants, multiple outputs, exact large token quantities, datums, reference inputs
and collateral return. `txRisk.test.ts` asserts the registry hash from its script
bytes and language. The registry records the fixture's source; it is not a remote
reputation service or general script analyzer.

Run the focused tests with:

```powershell
node scripts/run-tests.mjs src/__tests__/txRisk.test.ts --runInBand
node scripts/plutus-manual-fixture.mjs
```

These checks do not sign, submit or establish on-chain acceptance.

## Builder review integration (phases 2–3)

`buildDraftTx` accepts optional trusted risk context/provider options. The browser
opts in and attaches the completed assessment; other consumers retain their current
behavior until their planned integration. Output review includes every native asset.

`reviewBuiltTransaction` validates the CBOR hash and refreshes chain facts for every
action, both before the dialog and after confirmation. `revalidate-review.ts` is
shared with pending signing and compares the full assessment, including contract
details and budgets. Changed/incomplete facts stop the action with retry/rebuild
guidance; the next attempt needs a new decision and acknowledgment. These checks
establish point-in-time availability, not a reservation of inputs or collateral.
It binds the decision to exact bytes and assessment, including version and network.
The caller supplies draft/environment currentness checks and the dialog;
no acceptance is persisted or reused across actions. `review-policy.ts` exposes
presentation-only completeness/acknowledgment helpers without loading codecs.

The builder's freshness callback includes draft identity/revision, source, wallet
identity/script, network and connected signer/account. Proposal/replacement signing
uses the existing `beforeSign` hook after the proxy audit, with currentness checks
after both asynchronous operations. Connected signing retains its existing
readiness/currentness checks. Copy
passes through the same review before accessing the clipboard.

Tests: `txRiskReview.test.ts` covers real-codec action policy/build integration;
`useTransactionReview.test.ts` covers signing hook ordering and invalidation;
`e2e/risk-components.config.ts` runs isolated production-component browser tests
with mocked external actions. This is not authenticated-wallet or on-chain evidence.

## Pending co-signer integration (phase 4)

`usePendingTransactionReview` resolves stored CBOR when a pending card is displayed
and again on every signing attempt. The card uses the assessment's decoded output
amounts/destinations for its output list and token-flow outputs; stored JSON and
editor compatibility do not authorize or suppress script warnings.

`reviewPendingTransaction` checks the actual body hash, network, version and
completeness before requesting a decision. Known anyone-can-spend outputs require
explicit acknowledgment from this signer. Live facts are refreshed after the
dialog; changed facts require a new attempt. The hook cancels decisions when the
pending row/body, account, connected wallet, selected network or native-script
context changes. Payment-key witness additions retain review identity; changes to
contract witnesses invalidate review even when the body hash is unchanged. Acceptance is never
stored on a transaction or reused for another signing attempt.

The pending card retains proxy auditing and payment/collateral witness verification.
Currentness is checked after asynchronous audit, review, wallet and readiness calls
before automatic submission. Readiness still decides whether additional witnesses
are needed. Imported collateral returns retain selected-minus-returned exposure;
return amount/destination and owners are visible. Decode/provider failures retain
warnings, offer retry and cannot authorize signing.

Tests: `pendingRiskReview.test.ts` uses serialized fixtures and live-provider mocks;
`pendingTransactionCard.test.ts` exercises the production card signing path and
misleading/missing JSON with mocked external boundaries. The isolated Playwright
harness also mounts the production hook, summary and dialog with fixture assessments
at the codec/provider boundary. Full-app and five-case preprod results are recorded
in the [acceptance matrix](../../../docs/plutus-acceptance-matrix.md).

## Contract details and import boundaries (gap-remediation phases 2–4)

`contract-details.ts` supplies the read-only `contractDetails` assessment field,
independent of editable-draft compatibility or stored JSON. It records output datum
kind/value/hash by ledger output index (including collateral return), required keys,
and each Plutus spend's input reference, script hash/language/source, datum, redeemer
and recorded memory/step budget. Redeemers follow ledger input ordering. Decoded
JSON remains text to preserve integers above JavaScript's safe range. Exact CBOR
and named copy controls are presented by the shared contract-data components.

An identified Plutus spend requires a unique live input, a hash-matching script and
language from witnesses or resolved live reference/spending inputs, exactly one
indexed spending redeemer and its recorded budget. Inline data is decoded and
checked against a reported hash. A hash datum must match an actual transaction
datum witness; an external lookup cannot repair a missing witness. Required-fact
errors make the assessment incomplete and block signing. Output-only datum hashes
need no external value lookup. Optional labels do not determine completeness.

Datum-only details can require review even without risk findings. The contract
witness identity excludes payment-key signatures. `revalidate-review.ts` compares
the full refreshed assessment, including these details, after confirmation in both
builder and pending paths. This review does not evaluate a pending transaction or
interpret contract intent; budgets are explicitly recorded values. It does not add
minting/governance redeemer inspection or broaden editor support for reference
scripts and collateral returns. See the [draft boundary](../tx-draft/README.md).

## MCP integration (phase 5)

`src/lib/tx-review/` assesses completed preview/proposal CBOR with the authorized
free-UTxO handler's fresh facts. Pending review and proposal replay use the live
resolver. The summary adds `riskAssessment`; `messages.ts` projects full addresses,
exact quantities/units, output indexes and collateral facts into readable warnings
shared by text, HTML and PNG pages. Incomplete pending review remains explicit;
incomplete builds cannot mint a preview token or create a pending transaction.

`tx-review/risk.ts` binds the preview to a versioned risk fingerprint in the signed
draft token. Rebuilds may reselect ordinary native inputs and change returning to
the verified wallet. Changes to payment outputs, other script outputs, input risks,
collateral or wallet/network context require a fresh preview. Old tokens without
the fingerprint also require a new preview. Confirmation only creates an unsigned
pending transaction; each wallet signer still performs phase 4 review independently.

Pending output/fee/input-reference/body-hash presentation comes from CBOR, never
`txJson`. Missing labels remain optional; missing mandatory facts remain incomplete.
The PNG renderer emits all bounded warning pages instead of clipping risk details.
MCP tool imports remain lazy; no headless signing or script-spend capability was added.

## Phase 6 acceptance

The [release evidence record](../../../docs/transaction-script-risk-release.md)
maps the acceptance matrix to tests and records actual results separately from
preprod evidence and waived external checks. The [user guide](../../../docs/transaction-script-risk-review.md)
describes the builder, pending and MCP flows. Full-app scenarios live in
`e2e/tests/transaction-risk-guardrails.spec.ts`; the real-chain exercise in
`transaction-risk-preprod.spec.ts` requires explicit opt-in and records partial
progress for recovery. Isolated browser tests also verify named dialogs, labelled
acknowledgments, keyboard focus trapping and focus return on cancellation.
