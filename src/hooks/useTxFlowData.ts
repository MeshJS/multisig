import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { BlockfrostProvider } from "@meshsdk/core";

import type {
  BlockfrostTxInfo,
  BlockfrostTxUtxos,
  TxFlowData,
} from "@/types/blockfrost";
import type { ResolvedInputMap } from "@/utils/token-flow";
import { resolvedInputKey } from "@/utils/token-flow";
import { getProvider } from "@/utils/get-provider";
import { useSiteStore } from "@/lib/zustand/site";

/**
 * Fetches everything the token-flow visualization needs for one on-chain
 * transaction: /txs/{hash} + /txs/{hash}/utxos, plus the certificate /
 * withdrawal detail endpoints when the tx info says they're present
 * (typically 2 requests, worst case 6). Exported standalone so future
 * callers (e.g. the transaction builder) can use queryClient.fetchQuery.
 */
export async function fetchTxFlowData(
  provider: BlockfrostProvider,
  txHash: string,
): Promise<TxFlowData> {
  const [info, utxos] = (await Promise.all([
    provider.get(`/txs/${txHash}`),
    provider.get(`/txs/${txHash}/utxos`),
  ])) as [BlockfrostTxInfo, BlockfrostTxUtxos];

  const [withdrawals, delegations, stakes, poolUpdates] = await Promise.all([
    info.withdrawal_count > 0
      ? provider.get(`/txs/${txHash}/withdrawals`)
      : undefined,
    info.delegation_count > 0
      ? provider.get(`/txs/${txHash}/delegations`)
      : undefined,
    info.stake_cert_count > 0 ? provider.get(`/txs/${txHash}/stakes`) : undefined,
    info.pool_update_count > 0
      ? provider.get(`/txs/${txHash}/pool_updates`)
      : undefined,
  ]);

  return { info, utxos, withdrawals, delegations, stakes, poolUpdates };
}

/**
 * Lazily loads full tx context for the token-flow visualization. Confirmed
 * transactions are immutable, so results are cached forever — expanding the
 * same tx twice (or on another surface) costs zero extra requests.
 */
export function useTxFlowData(
  txHash: string | undefined,
  opts?: { enabled?: boolean },
) {
  const network = useSiteStore((state) => state.network);
  return useQuery<TxFlowData>({
    queryKey: ["tx-flow", network, txHash],
    queryFn: () => fetchTxFlowData(getProvider(network), txHash!),
    enabled: !!txHash && (opts?.enabled ?? true),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}

/** Rate-limit safety valve for pending txs with many distinct source txs. */
const MAX_RESOLVE_FETCHES = 10;

/**
 * Resolves pending-tx inputs that lack address/amount in the builder body by
 * fetching each unique source transaction's UTxOs. Returns a map keyed by
 * "txHash#index" for `pendingTxToTokenFlow`. Inputs beyond the fetch cap
 * stay unresolved and degrade to the "Unresolved inputs" node.
 */
export function useResolvedInputs(
  txIns: { txHash: string; txIndex: number }[],
  opts?: { enabled?: boolean },
): { resolvedInputs: ResolvedInputMap; isLoading: boolean } {
  const network = useSiteStore((state) => state.network);
  const uniqueHashes = useMemo(
    () =>
      [...new Set(txIns.map((txIn) => txIn.txHash))]
        .filter(Boolean)
        .slice(0, MAX_RESOLVE_FETCHES),
    [txIns],
  );

  const queries = useQueries({
    queries: uniqueHashes.map((hash) => ({
      queryKey: ["tx-utxos", network, hash],
      queryFn: async () =>
        (await getProvider(network).get(`/txs/${hash}/utxos`)) as BlockfrostTxUtxos,
      enabled: opts?.enabled ?? true,
      staleTime: Infinity,
      gcTime: Infinity,
      retry: 1,
    })),
  });

  // Stable-size dependency: stamps change whenever any query resolves.
  const dataStamp = queries.map((query) => query.dataUpdatedAt).join(",");
  const resolvedInputs = useMemo<ResolvedInputMap>(() => {
    const map: ResolvedInputMap = new Map();
    queries.forEach((query, i) => {
      const hash = uniqueHashes[i];
      if (!hash || !query.data) return;
      for (const output of query.data.outputs) {
        map.set(resolvedInputKey(hash, output.output_index), {
          address: output.address,
          amount: output.amount,
        });
      }
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueHashes, dataStamp]);

  return {
    resolvedInputs,
    isLoading: queries.some((query) => query.isLoading),
  };
}
