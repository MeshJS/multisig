import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import { ballotTitleMap } from "@/lib/governance/proposal-titles";
import { parseProposalId } from "@/lib/governance";
import {
  fetchProposalMetadataWithFallback,
} from "@/lib/governance/proposalMetadata";
import { useSiteStore } from "@/lib/zustand/site";
import { api } from "@/utils/api";
import { getProvider } from "@/utils/get-provider";
import type { ProposalDetails } from "@/types/governance";

/** normalizeProposalMetadata's synthetic title — means "unknown", not a title. */
const METADATA_FALLBACK_TITLE = "Metadata could not be loaded.";

/** Rate-limit safety valve for pending txs voting on many proposals. */
const MAX_TITLE_FETCHES = 10;

/**
 * Resolves governance proposal ids ("txHash#certIndex") to human-readable
 * proposal titles, returned as a synchronous lookup so it can be injected
 * into the pure token-flow adapters (the `labelAddress` pattern).
 *
 * Sources, in order: the wallet's ballots (titles are stored next to each
 * ballot item — zero network cost), then Blockfrost proposal metadata with
 * IPFS-gateway fallback, cached forever per network+id.
 */
export default function useProposalTitles(
  walletId: string | undefined,
  proposalIds: string[],
): { resolveProposalTitle: (proposalId: string) => string | undefined } {
  const network = useSiteStore((state) => state.network);

  const idsKey = useMemo(
    () => [...new Set(proposalIds)].sort().join("|"),
    [proposalIds],
  );
  const ids = useMemo(
    () => (idsKey ? idsKey.split("|") : []),
    [idsKey],
  );

  const { data: ballots } = api.ballot.getByWallet.useQuery(
    { walletId: walletId ?? "" },
    { enabled: !!walletId && ids.length > 0, staleTime: 30 * 1000 },
  );
  const ballotTitles = useMemo(() => ballotTitleMap(ballots), [ballots]);

  const missing = useMemo(
    () =>
      ids.filter((id) => !ballotTitles.has(id)).slice(0, MAX_TITLE_FETCHES),
    [ids, ballotTitles],
  );

  const queries = useQueries({
    queries: missing.map((id) => ({
      queryKey: ["proposal-title", network, id],
      staleTime: Infinity,
      gcTime: 60 * 60 * 1000,
      retry: 1,
      queryFn: async (): Promise<string | null> => {
        const { txHash, certIndex } = parseProposalId(id);
        const provider = getProvider(network);
        const metadata = await fetchProposalMetadataWithFallback({
          provider,
          proposal: {
            tx_hash: txHash,
            cert_index: certIndex,
            governance_type: "",
          },
          fetchDetails: async () =>
            (await provider
              .get(`/governance/proposals/${txHash}/${certIndex}`)
              .catch(() => null)) as ProposalDetails | null,
        });
        const title = metadata?.json_metadata.body.title;
        return title && title !== METADATA_FALLBACK_TITLE ? title : null;
      },
    })),
  });

  // Stable-size dependency: stamps change whenever any query resolves.
  const dataStamp = queries.map((query) => query.dataUpdatedAt).join(",");
  const fetchedTitles = useMemo(() => {
    const map = new Map<string, string>();
    queries.forEach((query, i) => {
      const id = missing[i];
      if (id && typeof query.data === "string") map.set(id, query.data);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, dataStamp]);

  const resolveProposalTitle = useMemo(
    () => (proposalId: string) =>
      ballotTitles.get(proposalId) ?? fetchedTitles.get(proposalId),
    [ballotTitles, fetchedTitles],
  );

  return { resolveProposalTitle };
}
