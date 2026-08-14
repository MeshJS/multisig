import type {
  AddressLabeler,
  AssetQuantity,
  TokenFlow,
  TransactionFlowNode,
} from "@/types/token-flow";
import { DREP_DEPOSIT } from "@/utils/protocol-deposit-constants";
import { getFirstAndLast } from "@/utils/strings";
import {
  meshCertificateToBadge,
  meshVoteToBadge,
  type ProposalTitleResolver,
} from "./certificates";
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
    /** Optional "txHash#certIndex" → proposal title lookup for vote badges. */
    resolveProposalTitle?: ProposalTitleResolver;
  },
): TokenFlow {
  const graph = new FlowGraphBuilder(opts.labelAddress);
  const txNodeId = `txp:${opts.txId}`;

  const badges = [
    ...(Array.isArray(txJson?.certificates)
      ? txJson.certificates.map(meshCertificateToBadge)
      : []),
    ...(Array.isArray(txJson?.votes)
      ? txJson.votes.map((vote: unknown) =>
          meshVoteToBadge(vote, opts.resolveProposalTitle),
        )
      : []),
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
      // Discriminate by UTxO ref so multiple spends from one address render
      // as separate edges; malformed bodies without a ref fall back to the
      // aggregated edge.
      const hasRef =
        typeof txIn.txHash === "string" && typeof txIn.txIndex === "number";
      graph.addEdge(
        node.id,
        txNodeId,
        "input",
        resolved.amount,
        hasRef
          ? `${getFirstAndLast(txIn.txHash, 8, 4)}#${txIn.txIndex}`
          : undefined,
        hasRef ? `${txIn.txHash}#${txIn.txIndex}` : undefined,
      );
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

  // Outputs. After Mesh's `complete()` the stored body INCLUDES the computed
  // change output(s), appended last (outputs are never re-sorted) — mark the
  // trailing run at the change address as change so it isn't double-rendered.
  // Never mark everything: a consolidation tx paying only the wallet keeps
  // its first output as the payment. Bodies without an embedded change
  // output (rows from older Mesh versions, hand-built imports) fall back to
  // the amount-less synthetic edge so the flow stays honest.
  const outputs = (Array.isArray(txJson?.outputs) ? txJson.outputs : []).filter(
    (output: any) => output?.address,
  );
  const changeAddress =
    typeof txJson?.changeAddress === "string" ? txJson.changeAddress : "";
  let firstChangeIndex = outputs.length;
  while (
    changeAddress &&
    firstChangeIndex > 1 &&
    outputs[firstChangeIndex - 1].address === changeAddress
  ) {
    firstChangeIndex--;
  }
  outputs.forEach((output: any, index: number) => {
    const node = graph.addressNode(output.address);
    const isChange = index >= firstChangeIndex;
    // The "change" discriminator keeps change separate from a genuine
    // payment edge to the same address (self-sends).
    graph.addEdge(
      txNodeId,
      node.id,
      "output",
      output.amount ?? [],
      isChange ? "change" : undefined,
      isChange ? "change" : undefined,
    );
  });
  if (changeAddress && firstChangeIndex === outputs.length) {
    const node = graph.addressNode(changeAddress);
    graph.addEdge(txNodeId, node.id, "output", [], "change", "change");
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
