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

function roundedQuantity(rawQuantity: string, decimals: number): string {
  const quantity = Number(rawQuantity) / Math.pow(10, decimals);
  return Math.abs(quantity) >= 1000
    ? numberWithCommas(Math.round(quantity * 100) / 100)
    : `${Math.round(quantity * 1e6) / 1e6}`;
}

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
  return `${roundedQuantity(asset.quantity, decimals)} ${assetName}`;
}

export type AssetDescription = {
  /** Full chip line, e.g. "1.5 ₳", "123.45 $PUKU", "SpaceBud #42". */
  text: string;
  /** Raw metadata image ref (ipfs://CID or base64 payload), when known. */
  image?: string;
  /** Metadata-known single indivisible unit — rendered NFT-style. */
  isNft: boolean;
};

/**
 * Richer chip description than formatAssetQuantity: known tokens surface
 * their name/ticker and image, and a metadata-known asset moving as a
 * single indivisible unit (decimals 0, quantity "1") renders NFT-style —
 * name only, no quantity prefix. Unknown units keep the truncated-unit
 * fallback so the display degrades to exactly the old behaviour.
 */
export function describeAsset(
  asset: AssetQuantity,
  metadata?: AssetMetadataMap,
): AssetDescription {
  if (asset.unit === "lovelace") {
    return { text: formatAssetQuantity(asset), isNft: false };
  }
  const meta = metadata?.[asset.unit];
  const image = meta?.image || undefined;
  if (meta?.assetName && meta.decimals === 0 && asset.quantity === "1") {
    return { text: truncateTokenSymbol(meta.assetName), image, isNft: true };
  }
  if (meta?.assetName && !meta.ticker) {
    return {
      text: `${roundedQuantity(asset.quantity, meta.decimals)} ${truncateTokenSymbol(meta.assetName)}`,
      image,
      isNft: false,
    };
  }
  return { text: formatAssetQuantity(asset, metadata), image, isNft: false };
}
