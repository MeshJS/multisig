# Script-risk assessment contract

This module implements the assessment and review policy for phases 0–3 of the
[guardrails plan](../../../docs/transaction-script-risk-guardrails-plan.md), under
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
`reviewBuiltTransaction`; phase 4 must independently review pending transactions
for each co-signer.

## Supported review contract

- Supported sources: multisig proposal, connected-wallet signing, other-address
  unsigned export, replacement editing and pending review (including API/MCP/import
  origins). Builder proposal, connected signing, replacement and unsigned-copy
  integration is implemented. Pending/co-signer and MCP integration remain planned.
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
action. It binds the decision to exact bytes and assessment, including version and
network. The caller supplies draft/environment currentness checks and the dialog;
no acceptance is persisted or reused across actions. `review-policy.ts` exposes
presentation-only completeness/acknowledgment helpers without loading codecs.

The builder's freshness callback includes draft identity/revision, source, wallet
identity/script, network and connected signer/account. Proposal/replacement signing
uses the existing `beforeSign` hook, with another freshness check after the proxy
audit. Connected signing retains its existing readiness/currentness checks. Copy
passes through the same review before accessing the clipboard.

Tests: `txRiskReview.test.ts` covers real-codec action policy/build integration;
`useTransactionReview.test.ts` covers signing hook ordering and invalidation;
`e2e/risk-components.config.ts` runs isolated production-component browser tests
with mocked external actions. This is not authenticated-wallet or on-chain evidence.
