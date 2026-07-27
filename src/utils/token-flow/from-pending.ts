import type {
  AddressLabeler,
  AssetQuantity,
  TokenFlow,
  TransactionFlowNode,
} from "@/types/token-flow";
import { DREP_DEPOSIT } from "@/utils/protocol-deposit-constants";
import { meshCertificateToBadge, meshVoteToBadge } from "./certificates";
import { FlowGraphBuilder, lovelace } from "./graph-builder";

export type ResolvedInputMap = Map<
  string, // "txHash#txIndex"
  { address: string; amount: AssetQuantity[] }
>;

export function resolvedInputKey(txHash: string, txIndex: number): string {
  return `${txHash}#${txIndex}`;
}

/**
 * Builds a TokenFlow from a pending transaction's parsed MeshTxBuilderBody
 * (`transaction.txJson`). Inputs may lack address/amount in the builder
 * body; callers can supply `resolvedInputs` (looked up on chain) — anything
 * still unknown is aggregated into a single "Unresolved inputs" node so the
 * flow always renders.
 */
export function pendingTxToTokenFlow(
  txJson: any,
  opts: {
    labelAddress: AddressLabeler;
    txId: string;
    description?: string | null;
    resolvedInputs?: ResolvedInputMap;
  },
): TokenFlow {
  const graph = new FlowGraphBuilder(opts.labelAddress);
  const txNodeId = `txp:${opts.txId}`;

  const badges = [
    ...(Array.isArray(txJson?.certificates)
      ? txJson.certificates.map(meshCertificateToBadge)
      : []),
    ...(Array.isArray(txJson?.votes) ? txJson.votes.map(meshVoteToBadge) : []),
  ];

  const fee =
    typeof txJson?.fee === "string" && BigInt(txJson.fee || "0") > 0n
      ? txJson.fee
      : undefined;

  const txNode: TransactionFlowNode = {
    id: txNodeId,
    kind: "transaction",
    status: "pending",
    label: opts.description ?? undefined,
    fee,
    badges,
  };
  graph.addNode(txNode);

  // Inputs
  let unresolvedCount = 0;
  for (const input of Array.isArray(txJson?.inputs) ? txJson.inputs : []) {
    const txIn = input?.txIn;
    if (!txIn) continue;
    const resolved =
      txIn.address && txIn.amount
        ? { address: txIn.address, amount: txIn.amount }
        : opts.resolvedInputs?.get(resolvedInputKey(txIn.txHash, txIn.txIndex));
    if (resolved) {
      const node = graph.addressNode(resolved.address, {
        partyType: input.type === "Script" ? "script" : undefined,
      });
      graph.addEdge(node.id, txNodeId, "input", resolved.amount);
    } else {
      unresolvedCount++;
    }
  }
  if (unresolvedCount > 0) {
    graph.addNode({
      id: "addr:unknown-inputs",
      kind: "address",
      address: "",
      label: `Unresolved inputs (${unresolvedCount})`,
      partyType: "unknown",
    });
    graph.addEdge("addr:unknown-inputs", txNodeId, "input", [], "unknown amount");
  }

  // Outputs (the builder body excludes the change output — represent it as
  // an amount-less edge to the change address so the flow stays honest).
  for (const output of Array.isArray(txJson?.outputs) ? txJson.outputs : []) {
    if (!output?.address) continue;
    const node = graph.addressNode(output.address);
    graph.addEdge(txNodeId, node.id, "output", output.amount ?? []);
  }
  if (typeof txJson?.changeAddress === "string" && txJson.changeAddress) {
    const node = graph.addressNode(txJson.changeAddress);
    graph.addEdge(txNodeId, node.id, "output", [], "change");
  }

  // Withdrawals
  for (const withdrawal of Array.isArray(txJson?.withdrawals)
    ? txJson.withdrawals
    : []) {
    if (!withdrawal?.address) continue;
    const node = graph.addressNode(withdrawal.address, {
      idPrefix: "stake",
      partyType: "reward",
    });
    graph.addEdge(node.id, txNodeId, "withdrawal", lovelace(withdrawal.coin ?? "0"));
  }

  // Deposits / refunds implied by certificates
  let deposit = 0n;
  for (const badge of badges) {
    if ("deposit" in badge && badge.deposit) {
      deposit += BigInt(badge.deposit);
    } else if (badge.label === "DRep Registration" && !("deposit" in badge && badge.deposit)) {
      deposit += BigInt(DREP_DEPOSIT);
    }
    if ("refund" in badge && badge.refund) deposit -= BigInt(badge.refund);
  }
  if (deposit > 0n) {
    graph.addEdge(txNodeId, graph.protocolNode("deposit").id, "deposit", lovelace(deposit));
    txNode.deposit = deposit.toString();
  } else if (deposit < 0n) {
    graph.addEdge(
      graph.protocolNode("deposit").id,
      txNodeId,
      "deposit-refund",
      lovelace(-deposit),
    );
    txNode.deposit = deposit.toString();
  }

  // Fee
  if (fee) {
    graph.addEdge(txNodeId, graph.protocolNode("fee").id, "fee", lovelace(fee));
  }

  // Mints / burns
  for (const mint of Array.isArray(txJson?.mints) ? txJson.mints : []) {
    if (!mint?.policyId || !Array.isArray(mint.mintValue)) continue;
    for (const value of mint.mintValue) {
      let amount: bigint;
      try {
        amount = BigInt(value?.amount ?? "0");
      } catch {
        continue;
      }
      if (amount === 0n) continue;
      const unit = `${mint.policyId}${value.assetName ?? ""}`;
      if (amount > 0n) {
        graph.addEdge(graph.protocolNode("mint").id, txNodeId, "mint", [
          { unit, quantity: amount.toString() },
        ]);
      } else {
        graph.addEdge(txNodeId, graph.protocolNode("mint").id, "burn", [
          { unit, quantity: (-amount).toString() },
        ]);
      }
    }
  }

  return graph.build();
}
