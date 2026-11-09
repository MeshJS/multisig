# Reviewing script-controlled transactions

The builder and pending transaction cards explain who controls the funds in a
transaction. Final review reads the transaction CBOR and fresh input/collateral
facts. A successful build or script evaluation is not a contract audit.

## Builder

Recipient warnings appear outside Advanced, including plain payments with no
datum. A datum on a key-controlled address does not make it script-controlled.
Verified change to the current wallet's own native script does not lose its
existing approval protection.

For other script addresses, the review explains that their rules have not been
verified. You may continue after review. For the exact known always-true script,
**anyone can spend the funds after transfer**. Review lists each affected output,
final ADA amount and every token's exact base-unit quantity. Duplicate recipients
remain separate outputs. Mainnet adds explicit real-asset wording; testnet still
requires acknowledgment. An `addr_test` address cannot distinguish preprod from
preview, so check the app and wallet network selections.

**Build** stays available without acknowledgment. **Build & propose**,
**Build & sign**, replacement signing and **Copy unsigned CBOR** require current
review. The anyone-can-spend checkbox starts unchecked on each attempt. Cancel
returns to editing without a wallet signature or export. Draft, source, account
and network changes invalidate the review. There is no global dismissal.

After confirmation, the builder checks chain facts again before opening your wallet
or copying unsigned CBOR. If an input or collateral was spent, facts changed, or
the provider is unavailable, the action stops with retry/rebuild guidance. Retry
review when the provider recovers, or rebuild with available inputs. Each attempt
requires a new decision and any required acknowledgment. Availability checks do not
reserve spending inputs or collateral.

## Funding and supported controls

A multisig Plutus proposal needs at least one available input controlled by that
wallet's native script, even when the script inputs cover the entire payment and
fee. Automatic selection retains one; manual selection must include an eligible
wallet input. If none is available, fund the multisig wallet or wait for its pending
inputs to become available, then rebuild. Collateral and explicit script spends
cannot serve as that wallet input. The wallet's threshold policy still applies;
collateral ownership alone does not authorize the proposal.

The supported spending combinations are V1 with a supplied datum matching the
on-chain hash, and V2/V3 with either an on-chain inline datum or a supplied matching
datum. All five have separate [confirmed preprod evidence](plutus-acceptance-matrix.md).
V1 with inline data is rejected. Outputs can be edited with inline datums only.
Supply an already-parameterized script and one existing eligible ADA-only collateral
UTxO from the connected signer. Automatic collateral creation, reservation and
return management are not available. Acceptance of these fixtures does not establish
support for every contract or wallet extension.

## Editing an imported proposal

The pending picker, card's edit action and builder link check the original CBOR,
wallet script and current chain facts together. Ordinary ADA/token transfers and
the supported Plutus shapes can be recovered even when old imported JSON lacks
input types or is missing/stale. Missing provider facts require a retry. Unsupported
fields, such as minting, withdrawals, validity windows, reference scripts/inputs,
output datum hashes or collateral-return controls, produce specific reasons why
editing is unavailable. Existing supported native staking and DRep ballots remain
editable when their identities match the builder's wallet context.

Without trustworthy builder output provenance, every output is retained, including
possible change and self-payments. Read the correction notice and check the output
list before rebuilding. Imported required keys remain required. Replacing a
partially signed proposal discards its old signatures and requires fresh signing.
An editing limitation does not hide the original transaction's review details.

## Pending co-signing

The visible script review applies to imported, API, legacy and MCP proposals too,
even when the editor cannot reconstruct them. Descriptions and JSON cannot hide
destinations or reduce the amounts decoded from CBOR. Every signer reviews
independently, including collateral-owner re-signing, a one-approval wallet and
the final co-signer who can trigger submission. A replacement needs fresh review.

The card and signing dialog show each output's datum by its zero-based ledger
index, so two outputs to the same address stay distinct. For each Plutus spend,
inspect the input reference, script hash and language, datum source and exact data,
redeemer CBOR, and memory/step budget. Pending budgets are **recorded in the
transaction**, not freshly evaluated by review. Decoded data describes the bytes;
it does not explain the contract's intent. Named copy controls retain exact CBOR,
and long values can be scrolled with the keyboard. Large integers remain exact.

Datum-only transactions also receive detail review. Missing script, datum witness,
redeemer, budget or required live-input facts block signing with retry/correction
guidance. An output datum hash alone does not require fetching its value. Changes
to contract witnesses invalidate review even if payment amounts and the body hash
stay the same; adding payment-key signatures alone can retain the open review.
Pending signing refreshes chain facts again after confirmation, just as the builder
does. Collateral and required-key checks still apply before submission.

Input warnings describe availability when recovering an always-true output.
They do not imply the recovered funds are exposed at a key-controlled destination.
Collateral review shows its owner, selected amount, any recorded return and maximum
exposure if an included transaction fails script execution. Acknowledgment does
not bypass proxy audits, owner witnesses, network checks or transaction readiness.

If required decoding or chain verification fails, the review says **Unable to
verify this transaction**. Retry pending review, or cancel and rebuild in the
builder. Unknown spending rules alone are not a verification failure.

## MCP review

Text, inline HTML and PNG detail pages carry the same CBOR-derived findings.
Read all warning pages and exact values before confirming. Changed exposure during
proposal rebuild requires a new preview (`REVIEW_CHANGED`). Confirmation creates
an **unsigned pending transaction**, with zero signatures. It neither spends
funds nor supplies acknowledgment for future human signers.

The scope is payment-output control, spending-input warnings and collateral;
it does not certify contracts or audit every other transaction feature. UI
acknowledgment is a review step, not an on-chain spending restriction.

Testing: [preprod guide](plutus-manual-preprod.md),
[release evidence](transaction-script-risk-release.md),
[module contract](../src/lib/tx-risk/README.md).
