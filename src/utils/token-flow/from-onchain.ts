import type { TxFlowData } from "@/types/blockfrost";
import type {
  AddressLabeler,
  FlowBadge,
  TokenFlow,
  TransactionFlowNode,
} from "@/types/token-flow";
import { getFirstAndLast } from "@/utils/strings";
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
  opts: {
    labelAddress: AddressLabeler;
    description?: string;
    /**
     * Badges known from outside the tx detail — e.g. the wallet DRep's
     * votes/certificates cross-referenced by tx hash, which Blockfrost's
     * per-tx endpoints don't expose. Appended after the detail-derived ones.
     */
    extraBadges?: FlowBadge[];
  },
): TokenFlow {
  const { info, utxos } = data;
  const graph = new FlowGraphBuilder(opts.labelAddress);
  const txId = `tx:${info.hash}`;
  const scriptFailed = info.valid_contract === false;

  const txNode: TransactionFlowNode = {
    id: txId,
    kind: "transaction",
    txHash: info.hash,
    status: "onchain",
    label: opts.description,
    fee: info.fees,
    blockHeight: info.block_height,
    deposit: !scriptFailed && info.deposit !== "0" ? info.deposit : undefined,
    badges: [
      ...(scriptFailed
        ? []
        : blockfrostCertBadges({
            delegations: data.delegations,
            stakes: data.stakes,
            poolUpdateCount: info.pool_update_count,
            poolRetireCount: info.pool_retire_count,
          })),
      ...(scriptFailed ? [] : (opts.extraBadges ?? [])),
      ...(scriptFailed || info.redeemer_count > 0
        ? [
            {
              kind: "script" as const,
              label: scriptFailed ? "Script failed" : "Plutus executed",
              color: scriptFailed
                ? "text-red-500 dark:text-red-400"
                : "text-amber-600 dark:text-amber-400",
              detail: scriptFailed
                ? "Only collateral was consumed; ordinary inputs and outputs did not take effect."
                : `${info.redeemer_count} redeemer${info.redeemer_count === 1 ? "" : "s"}`,
            },
          ]
        : []),
    ],
  };
  graph.addNode(txNode);

  // Collateral and reference inputs are not spent by a successful tx and
  // must not count as value flowing in (they would also corrupt the
  // mint/burn balance below). Collateral return outputs mirror that on the
  // output side when the script succeeded.
  const inputs = utxos.inputs.filter(
    (input) =>
      !input.reference && (scriptFailed ? input.collateral : !input.collateral),
  );
  const outputs = utxos.outputs.filter((output) =>
    scriptFailed ? output.collateral : !output.collateral,
  );

  // Dependencies use distinct cards and dashed edges, so collateral/reference
  // value never merges into ordinary funding or changes timeline joins.
  for (const input of utxos.inputs.filter(
    (item) => item.reference || (!scriptFailed && item.collateral),
  )) {
    const role = input.reference ? "reference" : "collateral";
    const ref = `${input.tx_hash}#${input.output_index}`;
    const node = graph.addressNode(input.address, {
      id: `${role}:${txId}:${ref}`,
    });
    node.role = role;
    node.label = role === "collateral" ? "Collateral" : "Reference input";
    node.details = [
      role === "collateral"
        ? "Kept · scripts succeeded"
        : "Read only · not spent",
    ];
    graph.addEdge(
      node.id,
      txId,
      role,
      role === "collateral" ? input.amount : [],
      `${getFirstAndLast(input.tx_hash, 8, 4)}#${input.output_index}`,
      ref,
      role === "collateral" ? "Collateral kept" : "Read only",
    );
  }

  // One edge per input UTxO (discriminated by its ref) so multiple spends
  // from the same address render as separate labeled edges.
  for (const input of inputs) {
    const hasDatum = !!(input.inline_datum || input.data_hash);
    const node = graph.addressNode(
      input.address,
      hasDatum
        ? { id: `datumin:${txId}:${input.tx_hash}#${input.output_index}` }
        : undefined,
    );
    if (hasDatum) {
      node.inlineDatum = !!input.inline_datum;
      node.details = input.inline_datum ? [] : ["Datum hash"];
    }
    graph.addEdge(
      node.id,
      txId,
      "input",
      input.amount,
      `${getFirstAndLast(input.tx_hash, 8, 4)}#${input.output_index}`,
      `${input.tx_hash}#${input.output_index}`,
      scriptFailed
        ? "Collateral consumed"
        : node.partyType === "script"
          ? "Script spend"
          : undefined,
    );
  }
  for (const output of outputs) {
    const hasDatum = !!(output.inline_datum || output.data_hash);
    const node = graph.addressNode(
      output.address,
      hasDatum ? { id: `datum:${txId}:${output.output_index}` } : undefined,
    );
    if (hasDatum) {
      node.inlineDatum = !!output.inline_datum;
      node.details = [
        `Output #${output.output_index}`,
        ...(output.inline_datum ? [] : ["Datum hash"]),
      ];
    }
    graph.addEdge(
      txId,
      node.id,
      "output",
      output.amount,
      undefined,
      hasDatum ? `${output.output_index}` : undefined,
      scriptFailed
        ? "Collateral return"
        : hasDatum
          ? `Output #${output.output_index}`
          : undefined,
    );
  }

  if (scriptFailed) {
    const balance = new Map<string, bigint>();
    inputs.forEach((input) => sumAssets(balance, input.amount));
    outputs.forEach((output) => sumAssets(balance, output.amount, -1n));
    const collected = balance.get("lovelace") ?? 0n;
    txNode.fee = collected.toString();
    if (collected > 0n) {
      // A per-transaction id prevents this label overwriting network fees in a timeline.
      const nodeId = `protocol:collateral:${info.hash}`;
      graph.addNode({
        kind: "protocol",
        role: "fee",
        id: nodeId,
        label: "Collateral collected",
      });
      graph.addEdge(txId, nodeId, "fee", lovelace(collected));
    }
    return graph.build();
  }

  if (BigInt(info.fees || "0") > 0n) {
    graph.addEdge(
      txId,
      graph.protocolNode("fee").id,
      "fee",
      lovelace(info.fees),
    );
  }

  const deposit = BigInt(info.deposit || "0");
  if (deposit > 0n) {
    graph.addEdge(
      txId,
      graph.protocolNode("deposit").id,
      "deposit",
      lovelace(deposit),
    );
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
      .map((a) => ({
        unit: a.unit,
        quantity: (-BigInt(a.quantity)).toString(),
      }));
    if (minted.length > 0) {
      graph.addEdge(graph.protocolNode("mint").id, txId, "mint", minted);
    }
    if (burned.length > 0) {
      graph.addEdge(txId, graph.protocolNode("mint").id, "burn", burned);
    }
  }

  return graph.build();
}
