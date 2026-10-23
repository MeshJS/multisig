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

## Pending co-signing

The visible script review applies to imported, API, legacy and MCP proposals too,
even when the editor cannot reconstruct them. Descriptions and JSON cannot hide
destinations or reduce the amounts decoded from CBOR. Every signer reviews
independently, including collateral-owner re-signing, a one-approval wallet and
the final co-signer who can trigger submission. A replacement needs fresh review.

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
