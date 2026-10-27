# Manual Plutus transaction-controls test

This fixture uses the [Hydra project's published Plutus V2 always-true validator](https://hydra.family/head-protocol/unstable/docs/how-to/commit-script-utxo). It has no owner check: anyone can spend its outputs. Use only the small disposable amounts of **preprod test ADA** described here, never mainnet funds or valuable tokens.

## Fixture values

This walkthrough uses the historical V2 inline fixture. The
[five-case acceptance matrix](plutus-acceptance-matrix.md) records separate V1
supplied-datum, V2 inline/supplied-datum and V3 inline/supplied-datum evidence.
The [fixture manifest](../e2e/fixtures/plutus-acceptance.json) contains each
validator's source, bytes, hash and address; do not relabel the V2 script as V1/V3.
V1 with inline data remains unsupported. For supplied-datum cases, the dedicated
`addFixtureFunding` test helper creates a hash-datum output; the normal output
editor remains inline-only. Select **Supply datum matching hash** when spending it
and enter the datum CBOR from the manifest's acceptance flow (`01`).

| Field                                | Value                                                             |
| ------------------------------------ | ----------------------------------------------------------------- |
| Network                              | Preprod                                                           |
| Plutus version                       | V2                                                                |
| Script CBOR                          | `49480100002221200101`                                            |
| Script hash                          | `3a888d65f16790950a72daee1f63aa05add6d268434107cfa5b67712`        |
| Script address                       | `addr_test1wqag3rt979nep9g2wtdwu8mr4gz6m4kjdpp5zp705km8wys6t2kla` |
| Initial funding                      | 5 test ADA                                                        |
| Inline datum, CBOR hex               | `01`                                                              |
| Input datum source when spending     | On-chain inline datum                                             |
| Redeemer, CBOR hex                   | `01`                                                              |
| Edited redeemer for replacement test | `02`                                                              |

No compiler installation or separate deployment transaction is needed. Sending an output to the derived script address creates the test UTxO; the spending transaction supplies the script bytes.

The address is **shared by every tester** using these script bytes. It is not a
personal deposit address. After funding, your multisig approval requirements no
longer protect that output: anyone can spend it, and another transaction may take
it before your recovery confirms. Record and spend only **your own confirmed
`transactionHash#outputIndex`**. Do not select another tester's output from the
address's UTxO list. If yours has already been spent, record that result and stop
that attempt; never substitute an unrelated output.

See [script-risk review](transaction-script-risk-review.md) for builder, pending
co-signer and MCP behavior, and the [phase 6 evidence record](transaction-script-risk-release.md)
for the distinction between automated checks and chain acceptance.

## 1. Fund the script

1. Confirm both the app and connected wallet are on **preprod**. Open a fresh Transaction Builder draft; exit pending-edit mode first.
2. Keep the multisig funding source. Add one recipient at the script address above for **5 ADA**.
3. Before opening Advanced, verify the visible **Anyone can spend** warning and
   the 5 ADA amount. The warning must already be present with **no datum or script
   input**. Change the recipient temporarily to your own key address and verify
   the warning clears; restore the script address. Then open **Advanced → Attach
   inline datum**, choose **CBOR hex**, and enter `01` for the later spending test.
4. If the connected signer does not already have a suitable ADA-only UTxO, add a separate **2 ADA** output to that signer's own preprod payment address, with **no datum and no tokens**. This is an example collateral amount for the tiny test, not a protocol minimum; the spending build will check sufficiency against its evaluated fee. Use the real wallet's address, never the synthetic address in the verifier.
5. Click **Build** and review the final amounts, including any minimum-ADA
   adjustment. Building must not prompt a wallet signature. Try **Copy unsigned
   CBOR** and **Build & propose**: each must show the outgoing warning and a fresh,
   unchecked acknowledgment. Cancel once and verify no wallet prompt appears.
   Then deliberately acknowledge and propose. Each remaining co-signer must see
   the warning outside collapsed details and independently acknowledge before
   their wallet prompt, including the signer who causes automatic submission.
6. Wait for chain confirmation. Record its transaction hash and the output index of the **5 ADA script output**. Do not assume an output index from the position of a card without checking the transaction.

Funding the output does not execute the validator and does not require script-input or collateral configuration. A transaction that is only pending has not created a spendable script UTxO yet.

## 2. Build a script spend

1. Open a fresh multisig draft and add an ordinary **2 ADA** output to your own preprod wallet address. Change returns to the multisig source.
2. Select the transaction and open **Advanced → Script inputs → Add script input**.
3. Enter the confirmed funding transaction hash/output index, choose **V2**, and paste the script CBOR above.
4. Choose the on-chain **inline datum** source. Use **CBOR hex** redeemer `01`.Please 
5. Verify the resolved input address and value match **your own** funded script
   output. Expect an input availability warning: anyone may spend it before your
   transaction confirms. Recovering to your key address must not display a new
   outgoing anyone-can-spend warning.
6. Under **Advanced → Collateral**, select the connected signer's ADA-only UTxO. Check the owner address, payment key and full selected exposure.
7. Click **Build**. Expect successful real provider evaluation, script/redeemer details, a fee, and a missing owner signature because these bytes are still unsigned. Build does not sign, propose or submit. Successful evaluation does not audit contract safety or guarantee the intended outcome. Check selected collateral, owner, recorded return (if any) and maximum exposure separately from the fee and minimum collateral requirement.

Use a multisig requiring at least two approvals for the following pending-edit test. Only provide the first approval initially.

## 3. Exercise pending editing and co-signing

1. **Build & propose**, accept the evaluated review and sign once. Leave the transaction pending.
2. **Edit pending** and reload it. Verify the script reference, V2 script bytes, inline datum source, redeemer, collateral reference and required key hashes survived.
3. Change the redeemer to `02`, then **Build**. This validator accepts both values; the build must still re-evaluate the changed transaction.
4. **Build & propose**, confirm replacement and sign the new bytes. Only fresh signatures should count.
5. Reload and verify redeemer `02` and the preserved collateral/required-key requirements.
6. Co-sign the replacement with the remaining authorized member. Confirm the required collateral-owner witness is present before submission, then check the resulting chain transaction and recovered funds.

An owner/account switch or spent collateral should produce a correction state, not silently choose a new owner. Imported required keys remain required even if the collateral selection changes. This script has no redeemer-based rejection branch; it is a successful-execution and round-trip fixture, not a negative contract-logic test.

## Reproduce the offline check

```powershell
node scripts/plutus-manual-fixture.mjs
```

The verifier uses the installed Mesh SDK and its real offline evaluator, synthetic
input/collateral references, and bundled cost models. It now executes all five
language/datum cases with both `01` and `02`: V1/V2 use 1,100 memory and 160,100
steps; V3 uses 500 memory and 64,100 steps. It checks script identity, supplied datum
witnesses, unsigned serialization and required keys. It does not access wallet
secrets, sign, make network requests, or submit anything. Its synthetic transaction
hashes must never be used in the wallet. `node scripts/plutus-acceptance-validators.mjs`
separately verifies reproducible V1/V3 compilation against the recorded manifest.

Offline execution is not preprod acceptance: record the actual funding and spending transaction hashes after the manual flow succeeds.

## Acceptance record

Use the table in [the release record](transaction-script-risk-release.md#controlled-preprod-and-release-gates).
Record the checkout commit/build, app URL, network, date, wallet approval threshold,
actual funding hash and output index, replacement body hash, submitted spending
hash and confirmed recovered amount. A body hash for an unsigned or pending
transaction is not evidence of submission. Record both signers' independent review
results and whether cancellation produced zero wallet prompts. Leave unperformed
steps explicitly pending. Do not put mnemonics, private keys or API keys in reports.

## Pending rebuild regression

Manual testing exposed a duplicate required-signer key when reloading a pending script spend: collateral setup and imported requirements both added the collateral owner's key. Blockfrost rejected the resulting CBOR before script execution. Removing only the duplicate requirement allowed the supplied transaction with redeemer `02` to evaluate successfully (1,100 memory units and 160,100 steps). Signing twice was not the cause.

The builder fix deduplicates these requirements. For an existing pending transaction,
verify collateral, change the redeemer to `02`, and retry step 3 above. Reuse its
script output while it remains unspent; no new funding transaction is needed.
The original diagnostic comparison only evaluated unsigned transactions.

The phase 6 controlled exercise on 2026-10-23 subsequently passed replacement,
independent co-signing and chain confirmation with the fix. Its actual funding and
spending hashes, confirmed amounts and unspent collateral are recorded in the
[release evidence](transaction-script-risk-release.md#controlled-preprod-and-release-gates).
