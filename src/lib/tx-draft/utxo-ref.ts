import type { DraftUtxoRef } from "@/types/tx-draft";

/** Pure display/identity helper; importing it does not load wallet codecs. */
export const utxoRefKey = (ref: DraftUtxoRef) =>
  `${ref.txHash.toLowerCase()}#${ref.outputIndex}`;
