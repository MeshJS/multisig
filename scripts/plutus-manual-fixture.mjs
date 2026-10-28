// Real offline execution of all five supported cases; no signing or networking.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MeshTxBuilder,
  OfflineFetcher,
  DEFAULT_V1_COST_MODEL_LIST,
  DEFAULT_V2_COST_MODEL_LIST,
  DEFAULT_V3_COST_MODEL_LIST,
} from "@meshsdk/core";
import { csl, OfflineEvaluator } from "@meshsdk/core-csl";

const manifest = JSON.parse(
  fs.readFileSync(
    new URL("../e2e/fixtures/plutus-acceptance.json", import.meta.url),
    "utf8",
  ),
);
const keyHash = "11".repeat(28);
const recipient = csl.EnterpriseAddress.new(
  0,
  csl.Credential.from_keyhash(csl.Ed25519KeyHash.from_hex(keyHash)),
)
  .to_address()
  .to_bech32();
const datumCbor = "01";
const datumHash = csl
  .hash_plutus_data(csl.PlutusData.from_hex(datumCbor))
  .to_hex();
const results = [];
for (const scenario of manifest.cases) {
  const script = manifest.validators.find(
    (v) => v.version === scenario.version,
  );
  const input = {
    input: { txHash: "aa".repeat(32), outputIndex: 0 },
    output: {
      address: script.address,
      amount: [{ unit: "lovelace", quantity: "5000000" }],
      ...(scenario.datumSource === "inline"
        ? { plutusData: datumCbor }
        : { dataHash: datumHash }),
    },
  };
  const collateral = {
    input: { txHash: "bb".repeat(32), outputIndex: 0 },
    output: {
      address: recipient,
      amount: [{ unit: "lovelace", quantity: "2000000" }],
    },
  };
  const fetcher = new OfflineFetcher("preprod");
  fetcher.addUTxOs([input, collateral]);
  const offline = new OfflineEvaluator(fetcher, "preprod");
  const evaluator = {
    evaluateTx: (tx, utxos = [], txs = []) =>
      offline.evaluateTx(tx, utxos, txs),
  };
  const executions = [];
  for (const redeemer of ["01", "02"]) {
    const builder = new MeshTxBuilder({ fetcher, evaluator });
    builder
      .setNetwork("preprod")
      .setCostModels([
        DEFAULT_V1_COST_MODEL_LIST,
        DEFAULT_V2_COST_MODEL_LIST,
        DEFAULT_V3_COST_MODEL_LIST,
      ])
      .spendingPlutusScript(script.version)
      .txIn(input.input.txHash, 0, input.output.amount, script.address, 0)
      .txInScript(script.code);
    if (scenario.datumSource === "inline") builder.txInInlineDatumPresent();
    else builder.txInDatumValue(datumCbor, "CBOR");
    builder
      .txInRedeemerValue(redeemer, "CBOR")
      .txInCollateral(
        collateral.input.txHash,
        0,
        collateral.output.amount,
        recipient,
      )
      .requiredSignerHash(keyHash)
      .txOut(recipient, [{ unit: "lovelace", quantity: "2000000" }])
      .changeAddress(recipient);
    const unsigned = await builder.complete();
    const actions = await evaluator.evaluateTx(unsigned);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].tag, "SPEND");
    assert.ok(actions[0].budget.mem > 0 && actions[0].budget.steps > 0);
    const tx = csl.Transaction.from_hex(unsigned);
    assert.equal(tx.witness_set().vkeys()?.len() ?? 0, 0);
    assert.equal(tx.witness_set().redeemers().get(0).data().to_hex(), redeemer);
    assert.equal(tx.body().required_signers().get(0).to_hex(), keyHash);
    assert.equal(
      tx.witness_set().plutus_scripts().get(0).hash().to_hex(),
      script.hash,
    );
    if (scenario.datumSource === "supplied") {
      const datum = tx.witness_set().plutus_data().get(0);
      assert.equal(datum.to_hex(), datumCbor);
      assert.equal(csl.hash_plutus_data(datum).to_hex(), datumHash);
    }
    executions.push({ redeemerCbor: redeemer, budget: actions[0].budget });
  }
  results.push({ ...scenario, script, datumCbor, datumHash, executions });
}
console.log(
  JSON.stringify(
    {
      network: "preprod",
      warning: manifest.warning,
      method:
        "Installed Mesh OfflineEvaluator: real execution, synthetic UTxOs, bundled cost models",
      onChainAcceptance: false,
      cases: results,
    },
    null,
    2,
  ),
);
