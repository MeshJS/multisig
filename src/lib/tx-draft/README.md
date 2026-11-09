# Transaction draft and reconstruction contract

Scope: [Plutus Transaction Controls](../../../vault/features/Plutus%20Transaction%20Controls.md)
and the [gap-remediation plan](../../../docs/plutus-transaction-controls-gap-plan.md).
The draft records editable intent; chain snapshots, evaluation budgets, signatures
and accepted reviews must not become reusable authority.

## Building and funding

`build-draft-tx.ts` resolves script inputs and connected-signer collateral afresh,
uses current protocol parameters, completes the transaction and evaluates the
completed bytes. `funding.ts` counts explicit script value once and excludes script
spends and collateral from ordinary funding. `to-tx-builder.ts` verifies the native
script against the source address/network and retains at least one eligible native
wallet input for multisig Plutus proposals even when script value covers all costs.
Manual selection remains exact and fails if it cannot meet this prerequisite.
Completion verifies the selected native inputs and matching script witness.

This retains `any`, `all`, `atLeast` and hierarchical policies without adding every
member as a required signer. Connected-wallet and address-source exports do not
inherit the multisig-input requirement. Pending locks and the edited transaction's
existing lock exception remain authoritative.

Spending supports supplied scripts with V1/hash-matching supplied datums and
V2/V3 inline or hash-matching supplied datums. V1 inline is rejected. Output editing
supports inline datums; hash-output funding is a test-fixture capability only.
Collateral is one existing eligible ADA-only key-controlled UTxO from the connected
signer. No automatic creation, reservation, collateral-return management, reference
script editor, general required-signers editor or headless Plutus spending is added.

## Pending import and editing

`reconstruct-pending.ts` is the shared asynchronous boundary for the pending picker,
card edit action and builder deep link. It receives original CBOR, authoritative
wallet/network/governance context and a provider. It checks encoded semantics before
consulting advisory JSON, verifies native script identity, resolves historical input
ownership and live availability, and associates redeemers with ledger-ordered input
references. Missing legacy input types or missing/stale JSON do not preclude recovery.

`from-tx-json.ts` and `read-pending-inputs.ts` remain representation adapters; a
JSON-only compatibility check is not authority for imported transactions. Supported
outputs, inline datums, script arguments and required keys survive reconstruction.
Versioned output provenance must agree with decoded outputs before generated change
is removed. Otherwise retain all outputs and the ambiguous-change correction notice.

Unsupported minting, withdrawals, validity windows, reference inputs/scripts, output
datum hashes, collateral-return controls and unrepresentable metadata or governance
fields fail with specific reasons. `pending-governance.ts` retains only the supported
native staking/DRep-ballot subset with matching identities. Unavailable required
provider facts also fail explicitly; neither path silently drops semantics.

Replacement uses the existing concurrency check, re-evaluates new bytes and discards
old signatures. Read-only contract review is independent of editor compatibility;
see [tx-risk](../tx-risk/README.md). Final signing/export refreshes chain facts after
confirmation and checks draft/account/network/wallet currentness around asynchronous
work. Point-in-time checks do not reserve inputs.

## Evidence

`txDraftBuild.test.ts`, `txDraftImportedPending.test.ts`, `txDraftPlutus.test.ts`,
`txDraftCollateral.test.ts` and the existing witness/readiness suites exercise these
boundaries. Full-app scenarios are in `builder-{output-datum,script-inputs,collateral,
imported-pending}.spec.ts`. The [acceptance matrix](../../../docs/plutus-acceptance-matrix.md)
separates offline execution, mocked application tests and five confirmed preprod
flows. The [release record](../../../docs/transaction-script-risk-release.md)
distinguishes completed validation from the human accessibility and deployment
checks waived by the maintainer on 2026-10-27.
