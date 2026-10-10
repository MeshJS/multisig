import type { UTxO } from "@meshsdk/core";

import type { AssetQuantity } from "@/types/token-flow";
import type { TxDraft } from "@/types/tx-draft";

/**
 * Lovelace auto-added to outputs that carry only native tokens — Cardano
 * forbids token-only outputs. Matches the existing new-transaction form's
 * constant; a real min-UTxO calculation is a later improvement.
 */
export const MIN_TOKEN_OUTPUT_LOVELACE = 1160000n;

export function safeBigInt(quantity: string): bigint | undefined {
  try {
    return BigInt(quantity);
  } catch {
    return undefined;
  }
}

/**
 * The assets an output will actually carry on-chain: the drafted assets plus
 * the min-ADA top-up when no lovelace entry is present.
 */
export function materializeOutputAssets(
  assets: AssetQuantity[],
): AssetQuantity[] {
  if (assets.length === 0) return assets;
  const hasLovelace = assets.some((asset) => asset.unit === "lovelace");
  return hasLovelace
    ? assets
    : [
        ...assets,
        { unit: "lovelace", quantity: MIN_TOKEN_OUTPUT_LOVELACE.toString() },
      ];
}

/** Total assets required across all outputs, including min-ADA top-ups. */
export function requiredAssetTotals(draft: TxDraft): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const output of draft.outputs) {
    for (const asset of materializeOutputAssets(output.assets)) {
      const quantity = safeBigInt(asset.quantity);
      if (quantity === undefined) continue;
      totals.set(asset.unit, (totals.get(asset.unit) ?? 0n) + quantity);
    }
  }
  return totals;
}

/** Sums the assets held by a set of UTxOs, keyed by unit. */
export function utxoFunds(utxos: UTxO[]): Map<string, bigint> {
  const funds = new Map<string, bigint>();
  for (const utxo of utxos) {
    for (const asset of utxo.output.amount) {
      const quantity = safeBigInt(asset.quantity);
      if (quantity === undefined) continue;
      funds.set(asset.unit, (funds.get(asset.unit) ?? 0n) + quantity);
    }
  }
  return funds;
}
