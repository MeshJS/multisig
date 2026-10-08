# Manual Plutus transaction-controls test

This fixture uses the [Hydra project's published Plutus V2 always-true validator](https://hydra.family/head-protocol/unstable/docs/how-to/commit-script-utxo). It has no owner check: anyone can spend its outputs. Use only the small disposable amounts of **preprod test ADA** described here, never mainnet funds or valuable tokens.

## Fixture values

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

## 1. Fund the script

1. Confirm both the app and connected wallet are on **preprod**. Open a fresh Transaction Builder draft; exit pending-edit mode first.
2. Keep the multisig funding source. Add one recipient at the script address above for **5 ADA**.
3. Select that output, open **Advanced → Attach inline datum**, choose **CBOR hex**, and enter `01`.
4. If the connected signer does not already have a suitable ADA-only UTxO, add a separate **2 ADA** output to that signer's own preprod payment address, with **no datum and no tokens**. This is an example collateral amount for the tiny test, not a protocol minimum; the spending build will check sufficiency against its evaluated fee. Use the real wallet's address, never the synthetic address in the verifier.
5. Click **Build**, review addresses/amounts/datum, then **Build & propose**. Collect the required approvals and let this funding transaction submit.
6. Wait for chain confirmation. Record its transaction hash and the output index of the **5 ADA script output**. Do not assume an output index from the position of a card without checking the transaction.

Funding the output does not execute the validator and does not require script-input or collateral configuration. A transaction that is only pending has not created a spendable script UTxO yet.

## 2. Build a script spend

1. Open a fresh multisig draft and add an ordinary **2 ADA** output to your own preprod wallet address. Change returns to the multisig source.
2. Select the transaction and open **Advanced → Script inputs → Add script input**.
3. Enter the confirmed funding transaction hash/output index, choose **V2**, and paste the script CBOR above.
4. Choose the on-chain **inline datum** source. Use **CBOR hex** redeemer `01`.
5. Verify the resolved input address and value match the funded script output.
6. Under **Advanced → Collateral**, select the connected signer's ADA-only UTxO. Check the owner address, payment key and full selected exposure.
7. Click **Build**. Expect successful real provider evaluation, script/redeemer details, a fee, and a missing owner signature because these bytes are still unsigned. Build does not sign, propose or submit.

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

The verifier uses the installed Mesh SDK and its real offline evaluator, synthetic input/collateral references, and bundled cost models. Both `01` and `02` executed successfully with 1,100 memory units and 160,100 steps. It derives the address, checks unsigned serialization and the required signer, and prints the fixture values. It does not access wallet secrets, sign, make network requests, or submit anything. Its synthetic transaction hashes must never be used in the wallet.

Offline execution is not preprod acceptance: record the actual funding and spending transaction hashes after the manual flow succeeds.

## Pending rebuild regression

Manual testing exposed a duplicate required-signer key when reloading a pending script spend: collateral setup and imported requirements both added the collateral owner's key. Blockfrost rejected the resulting CBOR before script execution. Removing only the duplicate requirement allowed the supplied transaction with redeemer `02` to evaluate successfully (1,100 memory units and 160,100 steps). Signing twice was not the cause.

The builder fix deduplicates these requirements. Once the running app includes it, reopen the original pending transaction, verify collateral, change the redeemer to `02`, and retry step 3 above. Reuse the existing script output while it remains unspent; no new funding transaction is needed. The diagnostic comparison only evaluated unsigned transactions and did not submit either one. Replacement, co-signing and chain confirmation still need the wallet test.
