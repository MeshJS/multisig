import type { MeshTxBuilder } from "@meshsdk/core";

import type {
  AddressLabeler,
  AssetQuantity,
  TokenFlow,
  TransactionFlowNode,
} from "@/types/token-flow";
import type { BuilderSelection, TxDraft } from "@/types/tx-draft";
import { getFirstAndLast } from "@/utils/strings";
import {
  draftCertificateToBadge,
  draftVoteToBadge,
  type PoolNameResolver,
  type ProposalTitleResolver,
} from "./certificates";
import { splitTrailingChange } from "./change";
import {
  assetMapToList,
  FlowGraphBuilder,
  lovelace,
  sumAssets,
} from "./graph-builder";

/**
 * The parts of a completed builder body (post-`complete()`) that a test
 * build overlays onto the draft flow: the fee, the concretely selected
 * inputs, and the change output(s) Mesh appends at the change address.
 */
export type DraftBuildOverlay = Pick<
  MeshTxBuilder["meshTxBuilderBody"],
  "inputs" | "outputs" | "changeAddress" | "fee"
>;

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
 *
 * With `opts.built` (a successful test build) the same graph gains the facts
 * only `complete()` can supply — the fee pill, one edge per selected input
 * instead of "auto selection", and the change amount — while every draft id
 * stays identical, so selection, positions and drag-connect are unaffected.
 */
export function draftToTokenFlow(
  draft: TxDraft,
  opts: {
    labelAddress: AddressLabeler;
    walletAddress: string;
    /** Optional "txHash#certIndex" → proposal title lookup for vote badges. */
    resolveProposalTitle?: ProposalTitleResolver;
    /** Optional pool id → pool name lookup for delegation badges. */
    resolvePoolName?: PoolNameResolver;
    /** Completed body of the current draft; overlays fee, inputs and change. */
    built?: DraftBuildOverlay | null;
  },
): TokenFlow {
  const graph = new FlowGraphBuilder(opts.labelAddress);
  const txNodeId = `txd:${draft.id}`;
  const built = opts.built ?? undefined;

  const builtFee =
    built && typeof built.fee === "string" && safeBigInt(built.fee) > 0n
      ? built.fee
      : undefined;

  const txNode: TransactionFlowNode = {
    id: txNodeId,
    kind: "transaction",
    status: "pending",
    label: draft.description || "New transaction",
    fee: builtFee,
    // Certificates before votes, matching the pending-view badge order.
    badges: [
      ...draft.certificates.map((cert) =>
        draftCertificateToBadge(cert, opts.resolvePoolName),
      ),
      ...draft.votes.map((vote) =>
        draftVoteToBadge(vote, opts.resolveProposalTitle),
      ),
    ],
  };
  graph.addNode(txNode);

  // Inputs — a built body knows the exact UTxOs (auto selection resolved);
  // manual picks are used verbatim by the builder, so the sets coincide.
  if (built) {
    for (const input of built.inputs) {
      const txIn = input.txIn;
      const node = graph.addressNode(txIn.address ?? opts.walletAddress);
      graph.addEdge(
        node.id,
        txNodeId,
        "input",
        txIn.amount ?? [],
        `${getFirstAndLast(txIn.txHash, 8, 4)}#${txIn.txIndex}`,
        `${txIn.txHash}#${txIn.txIndex}`,
      );
    }
  } else if (draft.utxoSelection.mode === "manual") {
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

  // Change — amount-less edge, same convention as pending flows; a built
  // body fills in the amount from the change output(s) complete() appended.
  // The edge id stays the same either way (no discriminator), so position
  // and selection mapping are unaffected by building.
  const changeNode = graph.addressNode(opts.walletAddress);
  if (built) {
    const { change } = splitTrailingChange(
      built.outputs,
      built.changeAddress || opts.walletAddress,
    );
    const changeAssets = builtChangeAssets(change);
    graph.addEdge(
      txNodeId,
      changeNode.id,
      "output",
      changeAssets,
      changeAssets.length > 0 ? "change" : "no change",
    );
  } else {
    graph.addEdge(txNodeId, changeNode.id, "output", [], "change");
  }

  // Fee — only a built body knows it; rendered as the "Network fee" pill.
  if (builtFee) {
    graph.addEdge(
      txNodeId,
      graph.protocolNode("fee").id,
      "fee",
      lovelace(builtFee),
    );
  }

  return graph.build();
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** Sums the change outputs' assets into one list (lovelace first). */
function builtChangeAssets(
  change: DraftBuildOverlay["outputs"],
): AssetQuantity[] {
  const totals = new Map<string, bigint>();
  for (const output of change) sumAssets(totals, output.amount ?? []);
  return assetMapToList(totals);
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
