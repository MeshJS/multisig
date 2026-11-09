// Read-only chain verification and public evidence export. Never signs or submits.
// node scripts/plutus-acceptance-evidence.mjs <persistent-state-dir> <report.json>
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { resolveTxHash } from "@meshsdk/core-cst";

const [directory, output] = process.argv.slice(2);
assert.ok(directory && output, "Supply the state directory and report path.");
const key = process.env.CI_BLOCKFROST_PREPROD_API_KEY;
assert.ok(key?.startsWith("preprod"), "A preprod Blockfrost key is required.");
const manifest = JSON.parse(
  fs.readFileSync(
    new URL("../e2e/fixtures/plutus-acceptance.json", import.meta.url),
    "utf8",
  ),
);
async function chain(endpoint) {
  const response = await fetch(
    `https://cardano-preprod.blockfrost.io/api/v0/${endpoint}`,
    { headers: { project_id: key } },
  );
  assert.ok(
    response.ok,
    `Chain verification failed (${response.status}) for ${endpoint}`,
  );
  return response.json();
}
const cases = [];
for (const scenario of manifest.cases) {
  const state = JSON.parse(
    fs.readFileSync(path.join(directory, `${scenario.id}.json`), "utf8"),
  );
  const script = manifest.validators.find(
    (v) => v.version === scenario.version,
  );
  assert.equal(state.status, "confirmed");
  assert.equal(state.network, "preprod");
  assert.equal(state.scriptHash, script.hash);
  assert.equal(state.scriptCbor, script.code);
  assert.equal(state.datumSource, scenario.datumSource);
  assert.equal(resolveTxHash(state.replacement.txCbor), state.spendingHash);
  const [funding, spending, confirmation] = await Promise.all([
    chain(`txs/${state.fundingHash}/utxos`),
    chain(`txs/${state.spendingHash}/utxos`),
    chain(`txs/${state.spendingHash}`),
  ]);
  assert.equal(confirmation.valid_contract, true);
  const funded = funding.outputs.find(
    (o) => o.output_index === state.scriptOutputIndex,
  );
  const collateral = funding.outputs.find(
    (o) => o.output_index === state.collateralOutputIndex,
  );
  assert.equal(funded.address, script.address);
  assert.deepEqual(funded.amount, [{ unit: "lovelace", quantity: "5000000" }]);
  assert.equal(funded.data_hash, state.datumHash);
  assert.equal(
    funded.inline_datum,
    scenario.datumSource === "inline" ? state.datumCbor : null,
  );
  assert.equal(funded.consumed_by_tx, state.spendingHash);
  assert.equal(collateral.consumed_by_tx, null);
  assert.deepEqual(collateral.amount, [
    { unit: "lovelace", quantity: "2000000" },
  ]);
  assert.ok(
    spending.inputs.some(
      (i) =>
        i.tx_hash === state.fundingHash &&
        i.output_index === state.scriptOutputIndex &&
        !i.collateral,
    ),
  );
  assert.ok(
    spending.inputs.some(
      (i) => i.address === state.walletAddress && !i.collateral,
    ),
  );
  assert.ok(
    spending.outputs.some(
      (o) =>
        o.address === collateral.address &&
        o.amount.some((a) => a.unit === "lovelace" && a.quantity === "2000000"),
    ),
  );
  const witnesses = state.verifiedWitnesses.filter(
    (w) => w.bodyHash === state.spendingHash,
  );
  assert.ok(new Set(witnesses.flatMap((w) => w.keyHashes)).size >= 2);
  cases.push({
    ...scenario,
    script,
    commit: state.commit,
    build: state.build,
    appUrl: state.appUrl,
    walletAddress: state.walletAddress,
    approvalThreshold: state.approvalThreshold,
    startedAt: state.startedAt,
    confirmedAt: state.confirmedAt,
    rejectedUnsignedDraftHashes: [
      state.rejectedUnsignedImportHash,
      state.rejectedUnsignedFunding?.hash,
    ].filter(Boolean),
    fundingRef: `${state.fundingHash}#${state.scriptOutputIndex}`,
    collateralRef: `${state.fundingHash}#${state.collateralOutputIndex}`,
    datumCbor: state.datumCbor,
    datumHash: state.datumHash,
    original: {
      bodyHash: resolveTxHash(state.original.txCbor),
      redeemerCbor: "01",
      budget: state.originalBudget,
    },
    replacement: {
      bodyHash: state.spendingHash,
      redeemerCbor: "02",
      budget: state.replacementBudget,
    },
    verifiedWitnesses: state.verifiedWitnesses,
    confirmation: {
      hash: state.spendingHash,
      block: confirmation.block,
      validContract: confirmation.valid_contract,
      fee: confirmation.fees,
    },
    recoveredOutputs: spending.outputs,
    collateralUnspent: true,
  });
}
const report = {
  network: "preprod",
  verifiedAt: new Date().toISOString(),
  cases,
};
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  `Verified all ${cases.length} confirmed spends and unspent collateral; wrote ${output}.`,
);
