import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { FlowBadge } from "@/types/token-flow";
import type {
  TxGovernanceRequest,
  TxGovernanceResponse,
} from "@/types/governance";
import { buildTxGovernanceBadgeMap } from "@/utils/token-flow";

/**
 * Governance badges (votes + DRep/committee certificates) per tx hash, via
 * POST /api/governance/txGovernance (Koios tx_info). Per-transaction rather
 * than per-DRep on purpose: the CI test wallet registers, votes with, and
 * retires a FRESH DRep every run, so no known-id lookup can cover its
 * activity — and Blockfrost has no per-tx endpoint for votes or DRep certs.
 *
 * Badges are decoration: every failure path degrades to an empty map.
 */

const TX_HASH_RE = /^[0-9a-f]{64}$/;
/** Mirrors the route's request cap. */
const MAX_TX_HASHES = 500;

const EMPTY_BADGE_MAP: Map<string, FlowBadge[]> = new Map();

export function useTxGovernanceBadges(opts: {
  txHashes: string[];
  network: number; // 0 preprod, 1 mainnet
}): Map<string, FlowBadge[]> {
  const { txHashes, network } = opts;
  // Sorted + deduped so the query key is order-insensitive: reshuffled ref
  // lists (timeline reorders internally anyway) hit the same cache entry.
  const hashes = useMemo(
    () =>
      [
        ...new Set(
          txHashes
            .map((hash) => hash.toLowerCase())
            .filter((hash) => TX_HASH_RE.test(hash)),
        ),
      ]
        .sort()
        .slice(0, MAX_TX_HASHES),
    [txHashes],
  );

  const query = useQuery({
    queryKey: ["tx-governance", network, hashes.join(",")],
    queryFn: async (): Promise<Map<string, FlowBadge[]>> => {
      const request: TxGovernanceRequest = { network, txHashes: hashes };
      const res = await fetch("/api/governance/txGovernance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error(`txGovernance responded ${res.status}`);
      const body = (await res.json()) as TxGovernanceResponse;
      // The Map itself is the cached data — referentially stable, so
      // downstream layout memos only recompute when data actually lands.
      return buildTxGovernanceBadgeMap(body.items);
    },
    // The site store can transiently hold a network sentinel — don't fire
    // doomed requests for it.
    enabled: hashes.length > 0 && (network === 0 || network === 1),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

  return query.data ?? EMPTY_BADGE_MAP;
}
