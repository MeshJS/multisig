import type { AssetQuantity } from "@/types/token-flow";
import { numberWithCommas, truncateTokenSymbol } from "@/utils/strings";

export type AssetMetadataMap = {
  [unit: string]: {
    assetName: string;
    decimals: number;
    image: string;
    ticker: string;
    policyId: string;
  };
};

/**
 * Formats one asset quantity following the transactions-page convention:
 * lovelace renders as ADA with 6 decimals and the ₳ sign, other units use
 * their registered ticker ("$TICKER") or a truncated unit string.
 */
export function formatAssetQuantity(
  asset: AssetQuantity,
  metadata?: AssetMetadataMap,
): string {
  const assetMetadata = metadata?.[asset.unit];
  const decimals =
    asset.unit === "lovelace" ? 6 : (assetMetadata?.decimals ?? 0);
  const assetName =
    asset.unit === "lovelace"
      ? "₳"
      : assetMetadata?.ticker
        ? `$${truncateTokenSymbol(assetMetadata.ticker)}`
        : truncateTokenSymbol(asset.unit);
  const quantity = Number(asset.quantity) / Math.pow(10, decimals);
  const rounded =
    Math.abs(quantity) >= 1000
      ? numberWithCommas(Math.round(quantity * 100) / 100)
      : `${Math.round(quantity * 1e6) / 1e6}`;
  return `${rounded} ${assetName}`;
}
