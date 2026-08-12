import type {
  AddressLabeler,
  TokenFlow,
  TransactionFlowNode,
} from "@/types/token-flow";
import type { BuilderSelection, TxDraft } from "@/types/tx-draft";
import { getFirstAndLast } from "@/utils/strings";
import {
  draftCertificateToBadge,
  draftVoteToBadge,
  type ProposalTitleResolver,
} from "./certificates";
import { FlowGraphBuilder } from "./graph-builder";

/**
 * Projects a builder draft onto the shared TokenFlow model so the canvas
 * builder renders with the exact same cards, edges and layout as the viewer.
 *
 * Id conventions (all stable across edits):
 *   - tx card:            "txd:<draftId>"        (no collision with tx:/txp:)
 *   - placed recipient:   "addr:<bech32>"        (shared with viewer flows)
 *   - unset recipient:    "draftout:<outputId>"  (placeholder card)
 * Output edges always carry the output id as discriminator, so edge → output
 * mapping is a suffix match and two outputs to one address stay separate.
 */
export function draftToTokenFlow(
  draft: TxDraft,
  opts: {
    labelAddress: AddressLabeler;
    walletAddress: string;
    /** Optional "txHash#certIndex" → proposal title lookup for vote badges. */
    resolveProposalTitle?: ProposalTitleResolver;
  },
): TokenFlow {
  const graph = new FlowGraphBuilder(opts.labelAddress);
  const txNodeId = `txd:${draft.id}`;

  const txNode: TransactionFlowNode = {
    id: txNodeId,
    kind: "transaction",
    status: "pending",
    label: draft.description || "New transaction",
    // Certificates before votes, matching the pending-view badge order.
    badges: [
      ...draft.certificates.map(draftCertificateToBadge),
      ...draft.votes.map((vote) =>
        draftVoteToBadge(vote, opts.resolveProposalTitle),
      ),
    ],
  };
  graph.addNode(txNode);

  // Inputs
  if (draft.utxoSelection.mode === "manual") {
    for (const utxo of draft.utxoSelection.utxos) {
      const node = graph.addressNode(utxo.output.address);
      graph.addEdge(
        node.id,
        txNodeId,
        "input",
        utxo.output.amount,
        `${getFirstAndLast(utxo.input.txHash, 8, 4)}#${utxo.input.outputIndex}`,
        `${utxo.input.txHash}#${utxo.input.outputIndex}`,
      );
    }
  } else {
    // Concrete inputs are only known at build time (keepRelevant).
    const node = graph.addressNode(opts.walletAddress);
    graph.addEdge(node.id, txNodeId, "input", [], "auto selection");
  }

  // Outputs — one edge per draft output, discriminated by output id.
  for (const output of draft.outputs) {
    let nodeId: string;
    if (output.address) {
      nodeId = graph.addressNode(output.address).id;
    } else {
      nodeId = `draftout:${output.id}`;
      graph.addNode({
        id: nodeId,
        kind: "address",
        address: "",
        label: "Set recipient",
        partyType: "unknown",
      });
    }
    graph.addEdge(
      txNodeId,
      nodeId,
      "output",
      output.assets,
      output.assets.length === 0 ? "no amount" : undefined,
      output.id,
    );
  }

  // Change — amount-less edge, same convention as pending flows.
  const changeNode = graph.addressNode(opts.walletAddress);
  graph.addEdge(txNodeId, changeNode.id, "output", [], "change");

  return graph.build();
}

/**
 * Maps a React Flow node or edge id back to the draft entity it represents.
 * Handles the layout's "@in"/"@out" address instance suffixes, placeholder
 * nodes, discriminated output edges, and resolves shared address nodes to the
 * first output paying that address (input-side/change nodes select the tx).
 */
export function flowIdToDraftEntity(
  draft: TxDraft,
  flowId: string,
): BuilderSelection {
  const baseId = flowId.replace(/@(in|out)$/, "");

  if (baseId.includes("->")) {
    // Edge id: `${source}->${target}:${kind}` + optional `:${discriminator}`.
    for (const output of draft.outputs) {
      if (baseId.endsWith(`:output:${output.id}`)) {
        return { kind: "output", outputId: output.id };
      }
    }
    return { kind: "tx" };
  }

  if (baseId === `txd:${draft.id}`) return { kind: "tx" };

  if (baseId.startsWith("draftout:")) {
    const outputId = baseId.slice("draftout:".length);
    return draft.outputs.some((output) => output.id === outputId)
      ? { kind: "output", outputId }
      : null;
  }

  if (baseId.startsWith("addr:")) {
    const address = baseId.slice("addr:".length);
    const output = draft.outputs.find((o) => o.address === address);
    if (output) return { kind: "output", outputId: output.id };
    return { kind: "tx" };
  }

  return null;
}
