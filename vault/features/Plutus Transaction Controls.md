---
type: feature
area: Wallets & Discovery
state: in-progress
owner: Andre
milestone: 2026-10
issues: []
updated: 2026-10-21
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
remaining browser/preprod acceptance work.

The [script-risk plan](../../docs/transaction-script-risk-guardrails-plan.md)
tracks the added guardrails. Phases 0–3 implement the review contract, serialized
fixtures, shared assessment, contextual builder warnings and per-action review
before builder signing or unsigned export. Pending co-signer and MCP integration
remain phases 4–5, with full-app/preprod acceptance in phase 6; this feature is not
marked delivered.

Code: `src/lib/tx-draft/`, `src/lib/tx-risk/`,
`src/components/pages/wallet/build/`. Fixtures/tests: `src/__tests__/txRisk.test.ts`
and `src/__tests__/fixtures/tx-risk.ts`; action review tests:
`src/__tests__/txRiskReview.test.ts` and `e2e/risk-components/`.

## Related

[[Multi-Signature Wallet Core]] · [[Collateral Service for Proxy]] ·
[[Transaction Builder & tRPC Tests]] · [[Multisig MCP Server]]
