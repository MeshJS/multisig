import type { TxFlowData } from "@/types/blockfrost";
import type { AddressLabeler, TokenFlow, TransactionFlowNode } from "@/types/token-flow";
import { blockfrostCertBadges } from "./certificates";
import {
  FlowGraphBuilder,
  assetMapToList,
  lovelace,
  sumAssets,
} from "./graph-builder";

/**
 * Builds a TokenFlow from full on-chain transaction context (see
 * `fetchTxFlowData`). Pure — address labeling is injected.
 */
export function onChainTxToTokenFlow(
  data: TxFlowData,
  opts: { labelAddress: AddressLabeler; description?: string },
): TokenFlow {
  const { info, utxos } = data;
  const graph = new FlowGraphBuilder(opts.labelAddress);
  const txId = `tx:${info.hash}`;

  const txNode: TransactionFlowNode = {
    id: txId,
    kind: "transaction",
    txHash: info.hash,
    status: "onchain",
    label: opts.description,
    fee: info.fee,
    deposit: info.deposit !== "0" ? info.deposit : undefined,
    badges: blockfrostCertBadges({
      delegations: data.delegations,
      stakes: data.stakes,
      poolUpdateCount: info.pool_update_count,
      poolRetireCount: info.pool_retire_count,
    }),
  };
  graph.addNode(txNode);

  // Collateral and reference inputs are not spent by a successful tx and
  // must not count as value flowing in (they would also corrupt the
  // mint/burn balance below). Collateral return outputs mirror that on the
  // output side when the script succeeded.
  const scriptFailed = info.valid_contract === false;
  const inputs = utxos.inputs.filter(
    (input) => !input.reference && (scriptFailed ? input.collateral : !input.collateral),
  );
  const outputs = utxos.outputs.filter(
    (output) => (scriptFailed ? output.collateral : !output.collateral),
  );

  for (const input of inputs) {
    const node = graph.addressNode(input.address);
    graph.addEdge(node.id, txId, "input", input.amount);
  }
  for (const output of outputs) {
    const node = graph.addressNode(output.address);
    graph.addEdge(txId, node.id, "output", output.amount);
  }

  if (BigInt(info.fee || "0") > 0n) {
    graph.addEdge(txId, graph.protocolNode("fee").id, "fee", lovelace(info.fee));
  }

  const deposit = BigInt(info.deposit || "0");
  if (deposit > 0n) {
    graph.addEdge(txId, graph.protocolNode("deposit").id, "deposit", lovelace(deposit));
  } else if (deposit < 0n) {
    graph.addEdge(
      graph.protocolNode("deposit").id,
      txId,
      "deposit-refund",
      lovelace(-deposit),
    );
  }

  for (const withdrawal of data.withdrawals ?? []) {
    const node = graph.addressNode(withdrawal.address, {
      idPrefix: "stake",
      partyType: "reward",
    });
    graph.addEdge(node.id, txId, "withdrawal", lovelace(withdrawal.amount));
  }

  // Mint/burn by mass balance: native assets only exist in inputs/outputs,
  // so any per-unit difference was minted (positive) or burned (negative).
  if (info.asset_mint_or_burn_count > 0) {
    const delta = new Map<string, bigint>();
    for (const output of outputs) sumAssets(delta, output.amount, 1n);
    for (const input of inputs) sumAssets(delta, input.amount, -1n);
    delta.delete("lovelace");
    const minted = assetMapToList(delta).filter((a) => BigInt(a.quantity) > 0n);
    const burned = assetMapToList(delta)
      .filter((a) => BigInt(a.quantity) < 0n)
      .map((a) => ({ unit: a.unit, quantity: (-BigInt(a.quantity)).toString() }));
    if (minted.length > 0) {
      graph.addEdge(graph.protocolNode("mint").id, txId, "mint", minted);
    }
    if (burned.length > 0) {
      graph.addEdge(txId, graph.protocolNode("mint").id, "burn", burned);
    }
  }

  return graph.build();
}
