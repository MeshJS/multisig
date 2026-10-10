import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";

/** Rate-limit safety valve; drafts hold at most one delegation today. */
const MAX_POOL_FETCHES = 10;

/**
 * Resolves bech32 pool ids to display names ("[TICKER] Name") from
 * Blockfrost pool metadata, returned as a synchronous lookup so it can be
 * injected into the pure token-flow adapters (the `labelAddress` /
 * `resolveProposalTitle` pattern). Cached forever per network+pool — pool
 * metadata changes rarely enough that a session-stale name is fine.
 */
export default function usePoolNames(poolIds: string[]): {
  resolvePoolName: (poolId: string) => string | undefined;
} {
  const network = useSiteStore((state) => state.network);

  // Stable-identity id list, deduped and capped.
  const idsKey = useMemo(
    () => [...new Set(poolIds)].sort().join("|"),
    [poolIds],
  );
  const ids = useMemo(
    () => (idsKey ? idsKey.split("|").slice(0, MAX_POOL_FETCHES) : []),
    [idsKey],
  );

  const queries = useQueries({
    queries: ids.map((poolId) => ({
      queryKey: ["pool-name", network, poolId],
      staleTime: Infinity,
      gcTime: 60 * 60 * 1000,
      retry: 1,
      queryFn: async (): Promise<string | null> => {
        const metadata = (await getProvider(network).get(
          `/pools/${poolId}/metadata`,
        )) as { name?: string | null; ticker?: string | null } | null;
        const name = metadata?.name?.trim();
        const ticker = metadata?.ticker?.trim();
        if (ticker && name) return `[${ticker}] ${name}`;
        return name || (ticker ? `[${ticker}]` : null);
      },
    })),
  });

  // Stable-size dependency: stamps change whenever any query resolves.
  const dataStamp = queries.map((query) => query.dataUpdatedAt).join(",");
  const resolvePoolName = useMemo(() => {
    const names = new Map<string, string>();
    queries.forEach((query, i) => {
      const id = ids[i];
      if (id && typeof query.data === "string") names.set(id, query.data);
    });
    return (poolId: string) => names.get(poolId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, dataStamp]);

  return { resolvePoolName };
}
