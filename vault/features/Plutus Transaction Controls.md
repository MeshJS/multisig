---
type: feature
area: Wallets & Discovery
state: delivered
owner: Andre
milestone: 2026-10
issues: []
updated: 2026-10-27
---

# Plutus Transaction Controls

Advanced transaction building for output datums, Plutus script spends and
redeemers, with signer-supplied collateral and clear script-risk review.
This feature records Andre's two October roadmap tasks and their guardrail work.

## Identity and source

The stable vault graph ID is **Plutus Transaction Controls**, derived from this
note's filename by the existing vault parser. A GitHub issue and a numbered
upstream PRD have not been assigned in the supplied scope; `issues` remains empty.
Reference this note and the implementation plans until an actual issue/PRD ID is
available. Do not use #221 as this feature's ID.

The maintainer confirmed on 2026-10-21 that the guardrails belong to these
[Month 7 roadmap tasks](../../ROADMAP.md#month-7--october-2026):

- **Output datum controls:** attach and edit validated inline datum values on
  individual outputs under Advanced, preserve each output-to-datum association
  through draft editing, and encode the datums in the unsigned transaction.
- **Plutus script-spend and redeemer controls:** configure Plutus-controlled
  inputs with their script, datum source and validated redeemer under Advanced;
  use an ADA-only collateral UTxO supplied by the connected signer, require its
  owner's signature, show exposure, and evaluate and preserve script data.

Automatic collateral creation, reservation and collateral-return management
remain in [[Collateral Service for Proxy]] (#221). Reading an existing imported
transaction's collateral return for risk review does not add return management.

## Guardrail acceptance contract

- Detect the payment credential, not the stake credential or presence of a datum.
- Recognize the exact published always-true validator by script hash on all
  supported address/network variants; describe its outputs as spendable by anyone.
- Verify own-wallet native script identity from authoritative wallet context.
  Other script rules remain unknown, never automatically certified safe.
- Distinguish funding a script, recovering a script input and exposing collateral.
  Preserve per-output identity and integer asset amounts.
- Use completed CBOR and resolved chain facts for final assessment. An unavailable
  mandatory fact yields an incomplete review, not an empty successful review.
- UI review must display risks before signing/export and require each signer
  to acknowledge known anyone-can-spend outputs for the current transaction.
- Preserve existing authorization, evaluation, proxy-audit and witness checks.

## Implementation status

The [transaction-controls plan](../../docs/plutus-transaction-controls-plan.md)
records the existing datum, script-input and collateral implementation and its
completed browser/preprod acceptance. Its Phase 7 evidence is consolidated with
the [gap-remediation plan](../../docs/plutus-transaction-controls-gap-plan.md).

The [script-risk plan](../../docs/transaction-script-risk-guardrails-plan.md)
tracks the added guardrails. Phases 0–5 implement the review contract, serialized
fixtures, shared assessment, contextual builder warnings, per-action review
before builder signing or unsigned export, and independent pending co-signer
review from CBOR. Each signer acknowledges known anyone-can-spend outputs; pending
replacement/account changes invalidate review. MCP text, inline HTML and paginated
PNG review now share CBOR-derived findings, with risk-bound preview tokens and fresh
review when proposal exposure changes. Phase 6 adds regression coverage, pending
CBOR freshness and focus-restoration fixes, documentation, and full-app/preprod
acceptance runners. Controlled preprod funding, redeemer replacement, independent
co-signing and recovery passed on 2026-10-23; collateral remained unspent.
Actual validation and rollout status are tracked in the
[release evidence record](../../docs/transaction-script-risk-release.md);
the feature is delivered under the revised scope recorded below, without a claim
that production deployment was performed.

Gap-remediation Phases 0–5 are complete. Multisig Plutus proposals retain an
available native wallet input even when script value covers the payment and fee;
manual funding must include one. Imports are reconstructed from CBOR and verified
chain facts, including legacy rows without input types. Unsupported semantics are
refused explicitly, ambiguous self/change outputs are preserved, required keys
survive rebuilding, and replacement discards prior signatures.

Each co-signer sees independently decoded output datums and spending script
hash/language, datum source/value, redeemer and recorded execution budgets. Review
is independent of editor compatibility. Missing mandatory facts block signing;
contract-witness changes invalidate review. Both builder and pending actions refresh
chain facts after confirmation before signing/export. These checks do not reserve
inputs or collateral.

The [2026-10-27 matrix](../../docs/plutus-acceptance-matrix.md) records separate
offline execution, full-app mocked-boundary tests and confirmed preprod spends for
V1 supplied hash datums, V2 inline/supplied hash datums and V3 inline/supplied hash
datums. V1 inline remains rejected; output editing is inline-only. The existing
signer-supplied collateral policy remains, with no automatic collateral service or
general reference-script, required-signers or headless Plutus editor.

Gap-remediation Phase 6 local checks and documentation reconciliation are complete.
On 2026-10-27 the maintainer removed the human mobile/screen-reader check and the
deployment target/smoke/rollback evidence requirement as completion gates. These
checks are waived, not performed. The feature is marked `delivered` under the
revised scope; automated browser results do not establish human accessibility or
production deployment results.

Code: `src/lib/tx-draft/`, `src/lib/tx-risk/`,
`src/components/pages/wallet/build/`. Fixtures/tests: `src/__tests__/txRisk.test.ts`
and `src/__tests__/fixtures/tx-risk.ts`; action review tests:
`src/__tests__/txRiskReview.test.ts` and `e2e/risk-components/`.

## Related

[[Multi-Signature Wallet Core]] · [[Collateral Service for Proxy]] ·
[[Transaction Builder & tRPC Tests]] · [[Multisig MCP Server]]
