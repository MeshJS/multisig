import type { MeshTxBuilder, UTxO } from "@meshsdk/core";
import type { ScriptInputResolution } from "@/lib/tx-draft/resolve-script-inputs";

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
> &
  Partial<Pick<MeshTxBuilder["meshTxBuilderBody"], "collaterals">>;

/**
 * Projects a builder draft onto the shared TokenFlow model so the canvas
 * builder renders with the exact same cards, edges and layout as the viewer.
 *
 * Id conventions (all stable across edits):
 *   - tx card:            "txd:<draftId>"        (no collision with tx:/txp:)
 *   - every recipient:    "draftout:<outputId>"  (independent of address)
 * Output edges always carry the output id as discriminator, so edge → output
 * mapping is a suffix match and two outputs to one address stay separate.
 *
 * With `opts.built` (a successful test build) the same graph gains the facts
 * only `complete()` can supply — the fee pill, one edge per selected input
 * instead of "auto selection", and the change amount — while every draft id
 * stays identical, so selection, positions and drag-connect are unaffected.
 */
/** Placeholder card shown while the source address isn't known yet. */
export const DRAFT_SOURCE_NODE_ID = "draftsource";

export function draftToTokenFlow(
  draft: TxDraft,
  opts: {
    labelAddress: AddressLabeler;
    /** The source (funding + change) address; "" while not yet known. */
    walletAddress: string;
    /** Optional "txHash#certIndex" → proposal title lookup for vote badges. */
    resolveProposalTitle?: ProposalTitleResolver;
    /** Optional pool id → pool name lookup for delegation badges. */
    resolvePoolName?: PoolNameResolver;
    /** Completed body of the current draft; overlays fee, inputs and change. */
    built?: DraftBuildOverlay | null;
    scriptResolutions?: ScriptInputResolution[];
    collateralUtxo?: UTxO;
  },
): TokenFlow {
  const graph = new FlowGraphBuilder(opts.labelAddress);
  const txNodeId = `txd:${draft.id}`;
  const built = opts.built ?? undefined;

  // The source card: the wallet address when known, else a placeholder
  // (a source set to "other address" before one is entered, or the
  // connected-wallet source without a connected wallet).
  const sourceNodeId = (): string => {
    if (opts.walletAddress) return graph.addressNode(opts.walletAddress).id;
    graph.addNode({
      id: DRAFT_SOURCE_NODE_ID,
      kind: "address",
      address: "",
      label: "Set source address",
      partyType: "self",
    });
    return DRAFT_SOURCE_NODE_ID;
  };

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
      ...(draft.scriptInputs.length
        ? [
            {
              kind: "script" as const,
              label: `${draft.scriptInputs.length} Plutus spend${draft.scriptInputs.length === 1 ? "" : "s"}`,
              color: "text-amber-600 dark:text-amber-400",
            },
          ]
        : []),
      ...draft.certificates.map((cert) =>
        draftCertificateToBadge(cert, opts.resolvePoolName),
      ),
      ...draft.votes.map((vote) =>
        draftVoteToBadge(vote, opts.resolveProposalTitle),
      ),
    ],
  };
  graph.addNode(txNode);

  // Stable per-input cards survive resolution and completion. Snapshots are
  // presentation only; the build pipeline still resolves everything afresh.
  const scriptRefs = new Set<string>();
  for (const input of draft.scriptInputs) {
    const ref = `${input.utxoRef.txHash.toLowerCase()}#${input.utxoRef.outputIndex}`;
    scriptRefs.add(ref);
    const completed = built?.inputs.find(
      (item) =>
        `${item.txIn.txHash.toLowerCase()}#${item.txIn.txIndex}` === ref,
    )?.txIn;
    const resolution = opts.scriptResolutions?.find(
      (item) => item.inputId === input.id,
    );
    const snapshot = resolution?.utxo;
    const matching =
      snapshot &&
      `${snapshot.input.txHash.toLowerCase()}#${snapshot.input.outputIndex}` ===
        ref
        ? snapshot
        : undefined;
    const address = completed?.address ?? matching?.output.address ?? "";
    const nodeId = `draftscript:${input.id}`;
    graph.addNode({
      id: nodeId,
      kind: "address",
      address,
      partyType: "script",
      role: "script",
      label: `Plutus ${input.script.version} input`,
      details: [
        input.datumSource.kind === "inline" ? "Inline datum" : "Supplied datum",
        input.redeemer.text.trim()
          ? "Redeemer configured"
          : "Redeemer required",
        ...(resolution?.issues.length && !built ? ["Needs attention"] : []),
      ],
    });
    graph.addEdge(
      nodeId,
      txNodeId,
      "input",
      completed?.amount ?? matching?.output.amount ?? [],
      address
        ? `${getFirstAndLast(input.utxoRef.txHash, 8, 4)}#${input.utxoRef.outputIndex}`
        : "unresolved amount",
      input.id,
      "Script spend",
    );
  }

  if (draft.scriptInputs.length || draft.collateral) {
    const ref = draft.collateral?.utxoRef;
    const matches = (hash: string, index: number) =>
      !!ref &&
      hash.toLowerCase() === ref.txHash.toLowerCase() &&
      index === ref.outputIndex;
    const completed = built?.collaterals?.find((item) =>
      matches(item.txIn.txHash, item.txIn.txIndex),
    )?.txIn;
    const snapshot = opts.collateralUtxo;
    const matching =
      snapshot && matches(snapshot.input.txHash, snapshot.input.outputIndex)
        ? snapshot
        : undefined;
    const nodeId = `draftcollateral:${draft.id}`;
    graph.addNode({
      id: nodeId,
      kind: "address",
      address: completed?.address ?? matching?.output.address ?? "",
      partyType: "signer",
      role: "collateral",
      label: ref ? "Collateral" : "Select collateral",
      details: ["Only consumed if scripts fail"],
    });
    graph.addEdge(
      nodeId,
      txNodeId,
      "collateral",
      completed?.amount ?? matching?.output.amount ?? [],
      ref
        ? `${getFirstAndLast(ref.txHash, 8, 4)}#${ref.outputIndex}`
        : "required",
      undefined,
      "Collateral at risk",
    );
  }

  // Inputs — a built body knows the exact UTxOs (auto selection resolved);
  // manual picks are used verbatim by the builder, so the sets coincide.
  if (built) {
    for (const input of built.inputs) {
      const txIn = input.txIn;
      if (scriptRefs.has(`${txIn.txHash.toLowerCase()}#${txIn.txIndex}`))
        continue;
      const nodeId = txIn.address
        ? graph.addressNode(txIn.address).id
        : sourceNodeId();
      graph.addEdge(
        nodeId,
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
    graph.addEdge(sourceNodeId(), txNodeId, "input", [], "auto selection");
  }

  // Outputs — one edge per draft output, discriminated by output id.
  for (const [index, output] of draft.outputs.entries()) {
    const nodeId = `draftout:${output.id}`;
    const label = output.address
      ? opts.labelAddress(output.address)
      : undefined;
    graph.addNode({
      id: nodeId,
      kind: "address",
      address: output.address,
      label: output.address
        ? label?.label || `Recipient ${index + 1}`
        : "Set recipient",
      partyType: label?.type ?? "unknown",
      inlineDatum: output.inlineDatum !== undefined,
    });
    graph.addEdge(
      txNodeId,
      nodeId,
      "output",
      built?.outputs[index]?.amount ?? output.assets,
      output.assets.length === 0 ? "no amount" : undefined,
      output.id,
    );
  }

  // Change — amount-less edge, same convention as pending flows; a built
  // body fills in the amount from the change output(s) complete() appended.
  // The edge id stays the same either way (no discriminator), so position
  // and selection mapping are unaffected by building.
  const changeNodeId = sourceNodeId();
  if (built) {
    const { change } = splitTrailingChange(
      built.outputs,
      built.changeAddress || opts.walletAddress,
      draft.outputs.length,
    );
    const changeAssets = builtChangeAssets(change);
    graph.addEdge(
      txNodeId,
      changeNodeId,
      "output",
      changeAssets,
      changeAssets.length > 0 ? "change" : "no change",
    );
  } else {
    graph.addEdge(txNodeId, changeNodeId, "output", [], "change");
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
 * nodes and discriminated output edges. Input/change addresses select the tx.
 */
export function flowIdToDraftEntity(
  draft: TxDraft,
  flowId: string,
): BuilderSelection {
  const baseId = flowId.replace(/@(in|out)$/, "");

  const script = draft.scriptInputs.find(
    (input) =>
      baseId === `draftscript:${input.id}` ||
      baseId.startsWith(`draftscript:${input.id}->`),
  );
  if (script) return { kind: "tx", inputId: script.id, field: "utxoRef" };
  if (
    baseId === `draftcollateral:${draft.id}` ||
    baseId.startsWith(`draftcollateral:${draft.id}->`)
  ) {
    return { kind: "tx", field: "collateral" };
  }

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
  // The source placeholder is edited through the tx inspector's source picker.
  if (baseId === DRAFT_SOURCE_NODE_ID) return { kind: "tx" };

  if (baseId.startsWith("draftout:")) {
    const outputId = baseId.slice("draftout:".length);
    return draft.outputs.some((output) => output.id === outputId)
      ? { kind: "output", outputId }
      : null;
  }

  if (baseId.startsWith("addr:")) {
    return { kind: "tx" };
  }

  return null;
}
