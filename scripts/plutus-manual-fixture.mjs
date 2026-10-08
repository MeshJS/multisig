// Run: node scripts/plutus-manual-fixture.mjs
// Real offline script execution over synthetic UTxOs; no signing or networking.
import assert from "node:assert/strict";
import {
  MeshTxBuilder,
  OfflineFetcher,
  resolvePlutusScriptAddress,
  resolveScriptHash,
  DEFAULT_V1_COST_MODEL_LIST,
  DEFAULT_V2_COST_MODEL_LIST,
  DEFAULT_V3_COST_MODEL_LIST,
} from "@meshsdk/core";
import { csl, OfflineEvaluator } from "@meshsdk/core-csl";

// Published Plutus V2 always-true validator, also used by our builder fixtures:
// https://hydra.family/head-protocol/unstable/docs/how-to/commit-script-utxo
// ANYONE can spend it. Use only disposable preprod test ADA.
const script = { version: "V2", code: "49480100002221200101" };
const address = resolvePlutusScriptAddress(script, 0);
const datumCbor = "01";
const scriptHash = resolveScriptHash(script.code, script.version);
assert.equal(
  csl.Address.from_bech32(address).payment_cred().to_scripthash().to_hex(),
  scriptHash,
);

// Public synthetic key hash only: no key, seed, wallet or real UTxO is needed.
const keyHash = "11".repeat(28);
const recipient = csl.EnterpriseAddress.new(
  0,
  csl.Credential.from_keyhash(csl.Ed25519KeyHash.from_hex(keyHash)),
)
  .to_address()
  .to_bech32();
const input = {
  input: { txHash: "aa".repeat(32), outputIndex: 0 },
  output: {
    address,
    amount: [{ unit: "lovelace", quantity: "5000000" }],
    plutusData: datumCbor,
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
  evaluateTx: (tx, utxos = [], txs = []) => offline.evaluateTx(tx, utxos, txs),
};
const verification = [];
for (const redeemer of ["01", "02"]) {
  const builder = new MeshTxBuilder({ fetcher, evaluator });
  builder
    .setNetwork("preprod")
    .setCostModels([
      DEFAULT_V1_COST_MODEL_LIST,
      DEFAULT_V2_COST_MODEL_LIST,
      DEFAULT_V3_COST_MODEL_LIST,
    ])
    .spendingPlutusScript("V2")
    .txIn(input.input.txHash, 0, input.output.amount, address, 0)
    .txInScript(script.code)
    .txInInlineDatumPresent()
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
  verification.push({ redeemerCbor: redeemer, budget: actions[0].budget });
}
console.log(
  JSON.stringify(
    {
      network: "preprod",
      warning:
        "Anyone can spend this test script. Use only disposable test ADA.",
      scriptVersion: script.version,
      scriptCbor: script.code,
      scriptHash,
      scriptAddress: address,
      fundingLovelace: "5000000",
      inlineDatumCbor: datumCbor,
      datumSource: "inline",
      redeemerCbor: "01",
      editedRedeemerCbor: "02",
      verification: {
        method:
          "Installed Mesh OfflineEvaluator (real execution, synthetic UTxOs and bundled cost models)",
        onChainAcceptance: false,
        executions: verification,
      },
    },
    null,
    2,
  ),
);
