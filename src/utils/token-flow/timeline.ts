import type { OnChainTransaction, UTXO } from "@/types/transaction";
import type {
  AddressLabeler,
  TokenFlow,
  TransactionFlowNode,
} from "@/types/token-flow";
import { FlowGraphBuilder } from "./graph-builder";

/**
 * Pure helpers for the multi-transaction timeline view: chronological
 * ordering of the wallet's on-chain transactions and the focus-window math
 * behind the ◀ ▶ step navigation. Kept free of React/React Flow so the
 * navigation logic is unit-testable.
 */

export type TimelineTxRef = {
  txHash: string;
  blockTime: number;
  blockHeight: number;
  txIndex: number;
  description?: string | null;
  /**
   * Inputs/outputs already held by the wallet store. When present the
   * timeline renders the tx from this immediately (no Blockfrost round-trip)
   * and upgrades to the full flow (fees, protocol edges, per-UTxO ports)
   * once the detail fetch lands.
   */
  utxos?: { inputs: UTXO[]; outputs: UTXO[] };
};

/** Tx node id as produced by the on-chain adapter. */
export function timelineTxNodeId(txHash: string): string {
  return `tx:${txHash}`;
}

/** Oldest → newest; ties broken by blockHeight, then txIndex, then hash. */
export function orderTimelineTxs(txs: TimelineTxRef[]): TimelineTxRef[] {
  return [...txs].sort((a, b) => {
    if (a.blockTime !== b.blockTime) return a.blockTime - b.blockTime;
    if (a.blockHeight !== b.blockHeight) return a.blockHeight - b.blockHeight;
    if (a.txIndex !== b.txIndex) return a.txIndex - b.txIndex;
    return a.txHash < b.txHash ? -1 : 1;
  });
}

/** Maps the wallet store's on-chain list, joining optional db descriptions. */
export function timelineTxsFromOnChain(
  txs: OnChainTransaction[],
  descriptions?: Map<string, string | null>,
): TimelineTxRef[] {
  return txs.map((tx) => ({
    txHash: tx.hash,
    blockTime: tx.tx.block_time,
    blockHeight: tx.tx.block_height,
    txIndex: tx.tx.tx_index,
    description: descriptions?.get(tx.hash) ?? undefined,
    utxos: { inputs: tx.inputs, outputs: tx.outputs },
  }));
}

/**
 * Basic TokenFlow from store-held inputs/outputs alone — the instant
 * fallback rendered before (or instead of) the full Blockfrost detail.
 * Edges aggregate per address (the store drops source-UTxO refs and
 * collateral flags); no fee/deposit/withdrawal/mint edges, since those need
 * the tx info endpoint. Node ids match `onChainTxToTokenFlow` exactly, so
 * the full flow replaces this one seamlessly.
 */
export function storeTxToTokenFlow(
  ref: TimelineTxRef,
  opts: { labelAddress: AddressLabeler },
): TokenFlow {
  const graph = new FlowGraphBuilder(opts.labelAddress);
  const txId = timelineTxNodeId(ref.txHash);
  const txNode: TransactionFlowNode = {
    id: txId,
    kind: "transaction",
    txHash: ref.txHash,
    status: "onchain",
    label: ref.description ?? undefined,
    blockHeight: ref.blockHeight,
    badges: [],
  };
  graph.addNode(txNode);
  for (const input of ref.utxos?.inputs ?? []) {
    const node = graph.addressNode(input.address);
    graph.addEdge(node.id, txId, "input", input.amount);
  }
  for (const output of ref.utxos?.outputs ?? []) {
    const node = graph.addressNode(output.address);
    graph.addEdge(txId, node.id, "output", output.amount);
  }
  return graph.build();
}

/**
 * The 1-2 tx ids in focus at step position k, where k indexes into the
 * ordered (oldest → newest) list of loaded tx ids: the tx at k plus its
 * older neighbour, clamped at the old end. Newest focus is k = length - 1.
 */
export function focusPair(orderedLoadedTxIds: string[], k: number): string[] {
  if (orderedLoadedTxIds.length === 0) return [];
  const clamped = Math.min(Math.max(k, 0), orderedLoadedTxIds.length - 1);
  const pair = orderedLoadedTxIds.slice(Math.max(0, clamped - 1), clamped + 1);
  return pair;
}

/**
 * Column band spanned by the focused txs: from the input column of the
 * oldest (2L) through the output column of the newest (2L+2). Layers come
 * from `layoutTokenFlow`'s `txLayer` return.
 */
export function focusColumnRange(
  txLayer: Map<string, number>,
  focusTxIds: string[],
): { minCol: number; maxCol: number } | undefined {
  const layers = focusTxIds
    .map((id) => txLayer.get(id))
    .filter((layer): layer is number => layer !== undefined);
  if (layers.length === 0) return undefined;
  return {
    minCol: 2 * Math.min(...layers),
    maxCol: 2 * Math.max(...layers) + 2,
  };
}
