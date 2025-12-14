/**
 * Blockchain API Caching Layer
 * 
 * Wraps Blockfrost API calls with Next.js caching to reduce external API requests.
 * Uses Next.js cache() and unstable_cache() for server-side caching.
 */

import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { BlockfrostProvider } from "@meshsdk/core";

/**
 * Cache configuration for different types of blockchain data
 */
export const CACHE_CONFIG = {
  // Frequently changing data (30s cache)
  UTXOS: {
    revalidate: 30,
    tags: ["utxos"],
  },
  // Transaction data (2min cache)
  TRANSACTIONS: {
    revalidate: 2 * 60,
    tags: ["transactions"],
  },
  // Asset metadata (10min cache - rarely changes)
  ASSET_METADATA: {
    revalidate: 10 * 60,
    tags: ["assets"],
  },
  // DRep info (5min cache)
  DREP_INFO: {
    revalidate: 5 * 60,
    tags: ["drep"],
  },
  // Address totals (30s cache)
  ADDRESS_TOTAL: {
    revalidate: 30,
    tags: ["address"],
  },
  // Transaction UTxOs (2min cache)
  TX_UTXOS: {
    revalidate: 2 * 60,
    tags: ["transactions"],
  },
} as const;

/**
 * Generate a cache key for blockchain API calls
 */
function getCacheKey(
  network: number,
  endpoint: string,
  params?: Record<string, string | number>,
): string {
  const paramString = params
    ? `_${Object.entries(params)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join("_")}`
    : "";
  return `blockchain_${network}_${endpoint.replace(/\//g, "_")}${paramString}`;
}

/**
 * Cached wrapper for Blockfrost provider GET requests
 * 
 * @param provider - Blockfrost provider instance
 * @param endpoint - API endpoint path
 * @param network - Network ID (0 = preprod, 1 = mainnet)
 * @param cacheConfig - Cache configuration
 * @param params - Optional query parameters for cache key generation
 */
export async function cachedGet<T>(
  provider: BlockfrostProvider,
  endpoint: string,
  network: number,
  cacheConfig: typeof CACHE_CONFIG[keyof typeof CACHE_CONFIG],
  params?: Record<string, string | number>,
): Promise<T> {
  const cacheKey = getCacheKey(network, endpoint, params);
  
  // Use unstable_cache for server-side caching
  const getCachedData = unstable_cache(
    async () => {
      return provider.get<T>(endpoint);
    },
    [cacheKey],
    {
      revalidate: cacheConfig.revalidate,
      tags: cacheConfig.tags,
    }
  );

  return getCachedData();
}

/**
 * Cached wrapper for Blockfrost provider fetchAddressUTxOs
 * 
 * @param provider - Blockfrost provider instance
 * @param address - Cardano address
 * @param network - Network ID (0 = preprod, 1 = mainnet)
 */
export async function cachedFetchAddressUTxOs(
  provider: BlockfrostProvider,
  address: string,
  network: number,
) {
  const cacheKey = getCacheKey(network, `addresses/${address}/utxos`);
  
  const getCachedData = unstable_cache(
    async () => {
      return provider.fetchAddressUTxOs(address);
    },
    [cacheKey],
    {
      revalidate: CACHE_CONFIG.UTXOS.revalidate,
      tags: [...CACHE_CONFIG.UTXOS.tags, `address:${address}`],
    }
  );

  return getCachedData();
}

/**
 * Helper to get cached address totals
 */
export async function cachedGetAddressTotal(
  provider: BlockfrostProvider,
  address: string,
  network: number,
) {
  const endpoint = `/addresses/${address}/total`;
  return cachedGet(
    provider,
    endpoint,
    network,
    CACHE_CONFIG.ADDRESS_TOTAL,
    { address },
  );
}

/**
 * Helper to get cached transaction UTxOs
 */
export async function cachedGetTxUtxos(
  provider: BlockfrostProvider,
  txHash: string,
  network: number,
) {
  const endpoint = `/txs/${txHash}/utxos`;
  return cachedGet(
    provider,
    endpoint,
    network,
    CACHE_CONFIG.TX_UTXOS,
    { txHash },
  );
}

/**
 * Helper to get cached DRep info
 */
export async function cachedGetDrepInfo(
  provider: BlockfrostProvider,
  drepId: string,
  network: number,
) {
  const endpoint = `/governance/dreps/${drepId}`;
  return cachedGet(
    provider,
    endpoint,
    network,
    CACHE_CONFIG.DREP_INFO,
    { drepId },
  );
}

/**
 * Helper to get cached asset metadata
 */
export async function cachedGetAssetMetadata(
  provider: BlockfrostProvider,
  assetUnit: string,
  network: number,
) {
  const endpoint = `/assets/${assetUnit}`;
  return cachedGet(
    provider,
    endpoint,
    network,
    CACHE_CONFIG.ASSET_METADATA,
    { assetUnit },
  );
}

/**
 * Helper to get cached address transactions
 */
export async function cachedGetAddressTransactions(
  provider: BlockfrostProvider,
  address: string,
  page: number,
  network: number,
  order: "asc" | "desc" = "desc",
) {
  const endpoint = `/addresses/${address}/transactions`;
  return cachedGet(
    provider,
    endpoint,
    network,
    CACHE_CONFIG.TRANSACTIONS,
    { address, page, order },
  );
}

