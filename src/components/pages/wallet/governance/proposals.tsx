import { Button } from "@/components/ui/button";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/ui/card-content";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/utils/api";
import ReactMarkdown from 'react-markdown';
import remarkGfm from "remark-gfm";
import { getProvider } from "@/utils/get-provider";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";
import { useSiteStore } from "@/lib/zustand/site";
import { ProposalMetadata, ProposalDetails } from "@/types/governance";
import Link from "next/link";
import VoteButton from "./proposal/voteButtton";
import { UTxO } from "@meshsdk/core";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronUp, Clock, Calendar, Coins, Hash, FileText } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { useProxy } from "@/hooks/useProxy";
import { useProxyData } from "@/lib/zustand/proxy";
import { useBallotModal } from "@/hooks/useBallotModal";
import { getProposalStatus as getProposalStatusValue, parseProposalId } from "@/lib/governance";
import { GovernanceTypeChip } from "@/components/pages/wallet/governance/gov-type-chip";
import {
  createProposalMetadataFallback,
  fetchProposalMetadataWithFallback,
  type ProposalMetadataListItem,
} from "@/lib/governance/proposalMetadata";

type VoteRecord = {
  tx_hash: string;
  cert_index: number;
  vote: "yes" | "no" | "abstain";
  proposal_tx_hash: string;
  proposal_cert_index: number;
  proposal_id: string;
};

type VotingStatistics = {
  total: number;
  yes: number;
  no: number;
  abstain: number;
};

// Aggregate Yes/No/Abstain tally for a single proposal, counted from the
// per-proposal votes endpoint. Blockfrost exposes no aggregate and no voting
// power, so this is a count of distinct voters' latest votes — not stake-
// weighted. `capped` marks tallies where pagination was bounded.
type ProposalTally = {
  proposalId?: string;
  yes: number;
  no: number;
  abstain: number;
  total: number;
  capped: boolean;
  // Set when the tally came from the DB cache; used to decide staleness.
  updatedAt?: string | Date;
};

type ProposalListItem = ProposalMetadataListItem & {
  enacted_epoch?: number | null;
  dropped_epoch?: number | null;
  expired_epoch?: number | null;
  ratified_epoch?: number | null;
};

type ProposalListStatus = Pick<
  ProposalDetails,
  "enacted_epoch" | "dropped_epoch" | "expired_epoch" | "ratified_epoch"
>;

const getProposalStatus = (details?: Partial<ProposalDetails> | null) => {
  const status = getProposalStatusValue(details as ProposalDetails | null | undefined);
  if (!status) return null;
  if (status === "enacted") {
    return { label: "Enacted", icon: CheckCircle2, color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" };
  }
  if (status === "dropped") {
    return { label: "Dropped", icon: XCircle, color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" };
  }
  if (status === "expired") {
    return { label: "Expired", icon: XCircle, color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" };
  }
  if (status === "ratified") {
    return { label: "Ratified", icon: CheckCircle2, color: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300" };
  }
  return { label: "Active", icon: Clock, color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" };
};

export default function AllProposals({ appWallet, utxos, selectedBallotId, onSelectBallot }: { appWallet: Wallet; utxos: UTxO[]; selectedBallotId?: string; onSelectBallot?: (id: string) => void }) {
  const network = useSiteStore((state) => state.network);
  const { multisigWallet } = useMultisigWallet();
  const { isProxyEnabled, selectedProxyId } = useProxy();
  const { proxies } = useProxyData(appWallet?.id);
  const [proposals, setProposals] = useState<ProposalMetadata[]>([]);
  const [nextPage, setNextPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [votes, setVotes] = useState<Map<string, VoteRecord>>(new Map());
  const [loadingVotes, setLoadingVotes] = useState(false);
  const [expandedProposals, setExpandedProposals] = useState<Set<string>>(new Set());
  const [votingStatistics, setVotingStatistics] = useState<VotingStatistics>({ total: 0, yes: 0, no: 0, abstain: 0 });
  const [proxyDrepId, setProxyDrepId] = useState<string | null>(null);
  const [proposalDetails, setProposalDetails] = useState<Map<string, ProposalDetails>>(new Map());
  const [proposalListStatuses, setProposalListStatuses] = useState<Map<string, ProposalListStatus>>(new Map());
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
  const [proposalTallies, setProposalTallies] = useState<Map<string, ProposalTally>>(new Map());
  const { openModal, setCurrentProposal } = useBallotModal();
  const count = 10;
  const order = "desc";

  // Get DRep ID for fetching voting history (proxy mode or standard mode)
  // Use multisig wallet DRep ID if available (it handles no DRep keys by using payment script),
  // otherwise fallback to appWallet (for legacy wallets without multisigWallet)
  const standardDrepId = multisigWallet ? multisigWallet.getDRepId() : appWallet?.dRepId;
  
  // Get proxy DRep ID if proxy is enabled
  useEffect(() => {
    const fetchProxyDrepId = async () => {
      const hasValidProxy = isProxyEnabled && selectedProxyId && proxies && proxies.length > 0;
      const selectedProxy = hasValidProxy ? proxies.find(p => p.id === selectedProxyId) : null;
      
      if (hasValidProxy && selectedProxy && appWallet?.scriptCbor) {
        // If proxy has drepId cached, use it
        if (selectedProxy.drepId) {
          setProxyDrepId(selectedProxy.drepId);
          return;
        }
        
        // Otherwise, calculate it from the proxy contract
        try {
          const txBuilder = await getTxBuilder(network);
          const proxyContract = new MeshProxyContract(
            {
              mesh: txBuilder,
              wallet: undefined,
              networkId: network,
            },
            {
              paramUtxo: JSON.parse(selectedProxy.paramUtxo || '{}'),
            },
            appWallet.scriptCbor,
          );
          proxyContract.proxyAddress = selectedProxy.proxyAddress;
          const drepId = proxyContract.getDrepId();
          setProxyDrepId(drepId);
        } catch (error) {
          console.error("Error getting proxy DRep ID:", error);
          setProxyDrepId(null);
        }
      } else {
        setProxyDrepId(null);
      }
    };
    
    fetchProxyDrepId();
  }, [isProxyEnabled, selectedProxyId, proxies, appWallet?.scriptCbor, network]);
  
  const dRepId = proxyDrepId || standardDrepId;

  const toggleProposal = (proposalId: string) => {
    setExpandedProposals(prev => {
      const newSet = new Set(prev);
      if (newSet.has(proposalId)) {
        newSet.delete(proposalId);
      } else {
        newSet.add(proposalId);
        // Fetch proposal details when expanding
        if (!proposalDetails.has(proposalId) && !loadingDetails.has(proposalId)) {
          fetchProposalDetails(proposalId);
        }
        // Expanding a proposal is user activity — warm its tally cache.
        requestTallyRefresh(proposalId);
      }
      return newSet;
    });
  };


  const fetchProposalDetails = async (proposalId: string) => {
    const { txHash, certIndex } = parseProposalId(proposalId);
    setLoadingDetails(prev => new Set(prev).add(proposalId));
    
    try {
      const blockchainProvider = getProvider(network);
      const details = await blockchainProvider.get(
        `/governance/proposals/${txHash}/${certIndex}`
      ) as ProposalDetails;
      
      setProposalDetails(prev => {
        const newMap = new Map(prev);
        newMap.set(proposalId, details);
        return newMap;
      });
    } catch (error: any) {
      if (error?.status !== 404) {
        console.error("Error fetching proposal details:", error);
      }
    } finally {
      setLoadingDetails(prev => {
        const newSet = new Set(prev);
        newSet.delete(proposalId);
        return newSet;
      });
    }
  };

  // Proposal vote tallies are cached server-side in the DB (see the governance
  // router) and recomputed from Blockfrost on demand. The list reads the cache
  // (fast) and triggers a background refresh on user activity — when a stale or
  // missing tally is loaded, and again whenever a proposal is expanded — so the
  // cache stays warm without any cron. Tallies older than this are refreshed.
  const TALLY_TTL_MS = 10 * 60 * 1000;
  const proposalIds = useMemo(
    () => proposals.map((p) => `${p.tx_hash}#${p.cert_index}`),
    [proposals],
  );
  const refreshingTallies = useRef<Set<string>>(new Set());

  const { data: cachedTallies } = api.governance.getProposalTallies.useQuery(
    { network, proposalIds },
    { enabled: proposalIds.length > 0 },
  );

  const refreshTally = api.governance.refreshProposalTally.useMutation({
    onSuccess: (tally) => {
      setProposalTallies((prev) => new Map(prev).set(tally.proposalId, tally));
    },
    onSettled: (_data, _err, variables) => {
      refreshingTallies.current.delete(variables.proposalId);
    },
  });

  const requestTallyRefresh = (proposalId: string) => {
    if (refreshingTallies.current.has(proposalId)) return;
    refreshingTallies.current.add(proposalId);
    refreshTally.mutate({ network, proposalId });
  };

  // Sync the cached read into local state.
  useEffect(() => {
    if (!cachedTallies) return;
    setProposalTallies((prev) => {
      const next = new Map(prev);
      for (const t of cachedTallies) next.set(t.proposalId, t);
      return next;
    });
  }, [cachedTallies]);

  // Activity-driven refresh: warm any tally that's missing or older than the TTL
  // once the cached read has resolved.
  useEffect(() => {
    if (!cachedTallies) return;
    for (const proposalId of proposalIds) {
      const cached = proposalTallies.get(proposalId);
      const fresh =
        cached?.updatedAt &&
        Date.now() - new Date(cached.updatedAt).getTime() < TALLY_TTL_MS;
      if (!fresh) requestTallyRefresh(proposalId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cachedTallies, proposalIds, network]);


  // Fetch DRep voting history
  useEffect(() => {
    async function fetchVotingHistory() {
      if (!dRepId) {
        setVotes(new Map());
        setVotingStatistics({ total: 0, yes: 0, no: 0, abstain: 0 });
        return;
      }
      
      setLoadingVotes(true);
      try {
        const blockchainProvider = getProvider(network);
        // Convert CIP-129 DRep ID to CIP-105 format for API
        const { getDRepIds } = await import("@meshsdk/core-cst");
        const drepIds = getDRepIds(dRepId);
        const cip105DrepId = drepIds.cip105;
        
        // Fetch all pages of votes
        let allVotes: any[] = [];
        let page = 1;
        let hasMore = true;
        
        while (hasMore) {
          const votesData: any[] = await blockchainProvider.get(
            `/governance/dreps/${cip105DrepId}/votes?count=100&page=${page}&order=asc`
          );
          
          if (Array.isArray(votesData) && votesData.length > 0) {
            allVotes = [...allVotes, ...votesData];
            if (votesData.length < 100) {
              hasMore = false;
            } else {
              page++;
            }
          } else {
            hasMore = false;
          }
        }
        
        const votesMap = new Map<string, VoteRecord>();
        const stats: VotingStatistics = { total: 0, yes: 0, no: 0, abstain: 0 };
        
        if (Array.isArray(allVotes)) {
          allVotes.forEach((vote: any) => {
            // Match votes to proposals using proposal_tx_hash and proposal_cert_index
            const proposalKey = `${vote.proposal_tx_hash}#${vote.proposal_cert_index}`;
            
            // Normalize vote to lowercase
            const voteValue = (vote.vote || "").toLowerCase() as "yes" | "no" | "abstain";
            
            // Store vote record
            votesMap.set(proposalKey, {
              tx_hash: vote.tx_hash,
              cert_index: vote.cert_index,
              vote: voteValue,
              proposal_tx_hash: vote.proposal_tx_hash,
              proposal_cert_index: vote.proposal_cert_index,
              proposal_id: vote.proposal_id,
            });
            
            // Update statistics
            stats.total++;
            if (voteValue === "yes") {
              stats.yes++;
            } else if (voteValue === "no") {
              stats.no++;
            } else if (voteValue === "abstain") {
              stats.abstain++;
            }
          });
        }
        
        setVotes(votesMap);
        setVotingStatistics(stats);
      } catch (error: any) {
        // Handle 404 or other errors gracefully - voting history is optional
        if (error?.status !== 404) {
          console.error("Error fetching voting history:", error);
        }
        // Set empty map on error
        setVotes(new Map());
        setVotingStatistics({ total: 0, yes: 0, no: 0, abstain: 0 });
      } finally {
        setLoadingVotes(false);
      }
    }
    
    fetchVotingHistory();
  }, [dRepId, network]);

  const createLoadingMetadata = (proposal: ProposalListItem): ProposalMetadata => ({
    tx_hash: proposal.tx_hash,
    cert_index: Number(proposal.cert_index),
    governance_type: proposal.governance_type,
    hash: "",
    url: "",
    bytes: "",
    json_metadata: {
      body: {
        title: "Loading...",
        abstract: "Loading...",
        motivation: "",
        rationale: "",
      },
      authors: [],
    },
  });

  const getListStatus = (proposal: ProposalListItem): ProposalListStatus => ({
    enacted_epoch: proposal.enacted_epoch ?? null,
    dropped_epoch: proposal.dropped_epoch ?? null,
    expired_epoch: proposal.expired_epoch ?? null,
    ratified_epoch: proposal.ratified_epoch ?? null,
  });

  const hydrateProposalPage = async ({
    blockchainProvider,
    proposalsData,
  }: {
    blockchainProvider: ReturnType<typeof getProvider>;
    proposalsData: ProposalListItem[];
  }) => {
    const proposalResponses = await Promise.all(
      proposalsData.map(async (p) => {
        const proposalId = `${p.tx_hash}#${p.cert_index}`;
        let fetchedDetails: ProposalDetails | null | undefined;
        const fetchDetails = async () => {
          if (fetchedDetails !== undefined) {
            return fetchedDetails;
          }
          fetchedDetails = (await blockchainProvider
            .get(`/governance/proposals/${p.tx_hash}/${p.cert_index}`)
            .catch(() => null)) as ProposalDetails | null;
          return fetchedDetails;
        };

        const metadata = await fetchProposalMetadataWithFallback({
          provider: blockchainProvider,
          proposal: p,
          fetchDetails,
        });

        return {
          key: proposalId,
          metadata: metadata ?? createProposalMetadataFallback(p),
          details: fetchedDetails ?? null,
        };
      }),
    );

    setProposals((prev) => {
      const updates = new Map(proposalResponses.map((res) => [res.key, res.metadata]));
      return prev.map((p) => {
        const key = `${p.tx_hash}#${p.cert_index}`;
        return updates.has(key) ? updates.get(key)! : p;
      });
    });

    setProposalDetails((prev) => {
      const newMap = new Map(prev);
      proposalResponses.forEach((res) => {
        if (res.details) {
          newMap.set(res.key, res.details);
        }
      });
      return newMap;
    });
  };

  useEffect(() => {
    setProposals([]);
    setProposalDetails(new Map());
    setProposalListStatuses(new Map());
    setNextPage(1);
    setHasMore(true);
    setIsLoading(true);

    const blockchainProvider = getProvider(network);
    blockchainProvider.get(`/governance/proposals?count=${count}&page=1&order=${order}`)
      .then(async (proposalsData: ProposalListItem[]) => {
        const skeletons = proposalsData.map(createLoadingMetadata);
        setProposals(skeletons);
        setProposalListStatuses(
          new Map(
            proposalsData.map((p) => [`${p.tx_hash}#${p.cert_index}`, getListStatus(p)]),
          ),
        );
        await hydrateProposalPage({ blockchainProvider, proposalsData });

        if (proposalsData.length < count) {
          setHasMore(false);
        } else {
          setNextPage(2);
        }
      })
      .finally(() => setIsLoading(false));
  }, [network]);

  async function loadMore() {
    if (!hasMore) return;
    setIsLoading(true);
    try {
      const blockchainProvider = getProvider(network);
      const proposalsData = (await blockchainProvider.get(
        `/governance/proposals?count=${count}&page=${nextPage}&order=${order}`,
      )) as ProposalListItem[];

      // 1. Insert placeholder skeletons using just tx_hash, cert_index, and governance_type.
      const existingIds = new Set(proposals.map(p => p.tx_hash + "#" + p.cert_index));
      const newProposalsData = proposalsData.filter(p => !existingIds.has(p.tx_hash + "#" + p.cert_index));

      const skeletons = newProposalsData.map(createLoadingMetadata);

      setProposals(prev => [...prev, ...skeletons]);
      setProposalListStatuses((prev) => {
        const next = new Map(prev);
        newProposalsData.forEach((p) => {
          next.set(`${p.tx_hash}#${p.cert_index}`, getListStatus(p));
        });
        return next;
      });
      await hydrateProposalPage({ blockchainProvider, proposalsData: newProposalsData });

      setNextPage(nextPage + 1);
      if (proposalsData.length < count) {
        setHasMore(false);
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <CardUI
      title="Proposals"
      description={`All proposals submitted by the community`}
    >
      <div className="flex flex-col gap-3 sm:gap-4">
        {/* Voting Statistics */}
        {dRepId && (
          <div className="mb-2 p-4 bg-white dark:bg-[#0A0A0B] rounded-lg border border-gray-200 dark:border-gray-800">
            <h3 className="text-sm font-semibold mb-3 text-gray-900 dark:text-gray-100">
              {isProxyEnabled ? "Proxy DRep" : "DRep"} Voting Statistics
            </h3>
            {loadingVotes ? (
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <div className="w-4 h-4 border-2 border-gray-300 dark:border-gray-500 border-t-gray-600 dark:border-t-gray-400 rounded-full animate-spin"></div>
                Loading voting history...
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center p-3 rounded-md bg-white dark:bg-[#0A0A0B] border border-gray-200 dark:border-gray-800">
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{votingStatistics.total}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Total Votes</div>
                </div>
                <div className="text-center p-3 rounded-md bg-white dark:bg-[#0A0A0B] border border-gray-200 dark:border-gray-800">
                  <div className="text-lg font-bold text-green-600 dark:text-green-400">{votingStatistics.yes}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Yes</div>
                </div>
                <div className="text-center p-3 rounded-md bg-white dark:bg-[#0A0A0B] border border-gray-200 dark:border-gray-800">
                  <div className="text-lg font-bold text-red-600 dark:text-red-400">{votingStatistics.no}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">No</div>
                </div>
                <div className="text-center p-3 rounded-md bg-white dark:bg-[#0A0A0B] border border-gray-200 dark:border-gray-800">
                  <div className="text-lg font-bold text-gray-600 dark:text-gray-400">{votingStatistics.abstain}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Abstain</div>
                </div>
              </div>
            )}
          </div>
        )}
        {proposals.length > 0 && (
          <div className="flex flex-col gap-3 sm:gap-4">
            {proposals.map((proposal) => {
              const proposalId = proposal.tx_hash + "#" + proposal.cert_index;
              return (
                <ProposalCard
                  key={proposalId}
                  proposal={proposal}
                  appWallet={appWallet}
                  utxos={utxos}
                  selectedBallotId={selectedBallotId}
                  vote={votes.get(proposalId)}
                  tally={proposalTallies.get(proposalId)}
                  isLoadingTally={!proposalTallies.has(proposalId)}
                  isExpanded={expandedProposals.has(proposalId)}
                  onToggle={() => toggleProposal(proposalId)}
                  details={proposalDetails.get(proposalId)}
                  listStatus={proposalListStatuses.get(proposalId)}
                  isLoadingDetails={loadingDetails.has(proposalId)}
                  setCurrentProposal={setCurrentProposal}
                  openModal={openModal}
                />
              );
            })}
          </div>
        )}
        {hasMore && (
          <div className="flex flex-row items-center justify-center gap-2 pt-2 sm:pt-4">
            <Button 
              variant="outline" 
              onClick={loadMore} 
              disabled={isLoading}
              className="w-full sm:w-auto text-sm sm:text-base"
            >
              {isLoading ? "Loading..." : "Load more"}
            </Button>
          </div>
        )}
        {proposals.length === 0 && !isLoading && (
          <EmptyState
            icon={FileText}
            title="No proposals found"
            description="There are no governance proposals to show here right now."
          />
        )}
      </div>
    </CardUI>
  );
}

// Live Yes/No/Abstain distribution for a proposal, counted by voter from the
// DB-cached tally. Not stake-weighted (Blockfrost exposes no voting power).
function VoteTallyBar({
  tally,
  loading,
}: {
  tally?: ProposalTally;
  loading?: boolean;
}): React.ReactElement {
  if (!tally && loading) {
    return (
      <div className="space-y-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-2 w-full animate-pulse rounded-full bg-gray-100 dark:bg-gray-800"
          />
        ))}
      </div>
    );
  }
  if (!tally || tally.total === 0) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500">
        No votes recorded yet
      </p>
    );
  }
  const rows: {
    label: "Yes" | "No" | "Abstain";
    value: number;
    bar: string;
    text: string;
  }[] = [
    { label: "Yes", value: tally.yes, bar: "bg-green-500", text: "text-green-700 dark:text-green-400" },
    { label: "No", value: tally.no, bar: "bg-red-500", text: "text-red-700 dark:text-red-400" },
    { label: "Abstain", value: tally.abstain, bar: "bg-gray-400 dark:bg-gray-500", text: "text-gray-600 dark:text-gray-400" },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const pct = tally.total > 0 ? Math.round((r.value / tally.total) * 100) : 0;
        return (
          <div key={r.label} className="flex items-center gap-2 text-xs">
            <span className="w-14 flex-shrink-0 text-gray-500 dark:text-gray-400">
              {r.label}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                className={`h-full rounded-full ${r.bar}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`w-9 flex-shrink-0 text-right font-medium tabular-nums ${r.text}`}>
              {pct}%
            </span>
            <span className="w-7 flex-shrink-0 text-right tabular-nums text-gray-400 dark:text-gray-500">
              {r.value}
            </span>
          </div>
        );
      })}
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        by votes · {tally.total}
        {tally.capped ? "+" : ""} voter{tally.total === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function ProposalCard({
  proposal,
  appWallet,
  utxos,
  selectedBallotId,
  vote,
  tally,
  isLoadingTally,
  isExpanded,
  onToggle,
  details,
  listStatus,
  isLoadingDetails,
  setCurrentProposal,
  openModal,
}: {
  proposal: ProposalMetadata;
  appWallet: Wallet;
  utxos: UTxO[];
  selectedBallotId?: string;
  vote?: VoteRecord;
  tally?: ProposalTally;
  isLoadingTally?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  details?: ProposalDetails;
  listStatus?: ProposalListStatus;
  isLoadingDetails?: boolean;
  setCurrentProposal: (proposalId?: string, proposalTitle?: string) => void;
  openModal: () => void;
}): React.ReactElement {
  const proposalId = proposal.tx_hash + "#" + proposal.cert_index;
  const statusSource = details ?? listStatus;

  // Convert the wallet's on-chain vote to display format.
  const voteDisplay = vote
    ? ({ yes: "Yes", no: "No", abstain: "Abstain" } as const)[vote.vote]
    : undefined;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition-all hover:border-gray-300 hover:shadow-md dark:border-gray-800 dark:bg-[#0A0A0B] dark:hover:border-gray-700">
      {/* Header (click to expand) */}
      <div
        onClick={onToggle}
        className="cursor-pointer p-4 transition-colors hover:bg-gray-50 sm:p-5 dark:hover:bg-gray-800/40"
      >
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/wallets/${appWallet.id}/governance/proposal/${proposal.tx_hash}:${proposal.cert_index}`}
            className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug text-gray-900 hover:underline sm:text-base dark:text-gray-100"
            onClick={(e) => e.stopPropagation()}
          >
            {proposal.json_metadata.body.title}
          </Link>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.();
            }}
            className="flex-shrink-0 rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={isExpanded ? "Collapse proposal" : "Expand proposal"}
          >
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            )}
          </button>
        </div>

        {/* Chips: status · type · voted pill · authors */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-gray-500 dark:text-gray-400">
          {statusSource && getProposalStatus(statusSource) && (() => {
            const status = getProposalStatus(statusSource)!;
            const StatusIcon = status.icon;
            return (
              <Badge className={`${status.color} flex w-fit items-center gap-1`}>
                <StatusIcon className="h-3 w-3" />
                {status.label}
              </Badge>
            );
          })()}
          <GovernanceTypeChip governanceType={proposal.governance_type} />
          {voteDisplay && <VoteBadge voteKind={voteDisplay} prefix="Voted " />}
          {proposal.json_metadata.authors.length > 0 && (
            <span className="break-words">
              <span className="font-medium">Authors:</span>{" "}
              {proposal.json_metadata.authors
                .map((author: any) => author.name)
                .join(", ")}
            </span>
          )}
        </div>
      </div>

      {/* Abstract + live tally (always visible on the card face) */}
      <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
        <div
          className={`prose prose-sm max-w-none break-words text-sm text-gray-600 dark:text-gray-300 ${
            isExpanded ? "" : "line-clamp-2"
          }`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {proposal.json_metadata.body.abstract}
          </ReactMarkdown>
        </div>
        <VoteTallyBar tally={tally} loading={isLoadingTally} />
      </div>

      {/* Expanded: details, your-vote, actions */}
      {isExpanded && (
        <div className="space-y-4 border-t border-gray-200 px-4 pb-4 pt-4 sm:px-5 sm:pb-5 dark:border-gray-800">
          {isLoadingDetails ? (
            <div className="flex items-center gap-2 border-b border-gray-200 pb-3 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 dark:border-gray-500 dark:border-t-gray-400"></div>
              Loading details...
            </div>
          ) : details && (
            <div className="grid grid-cols-1 gap-4 border-b border-gray-200 pb-3 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 dark:border-gray-800">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-xs font-medium text-gray-700 sm:text-sm dark:text-gray-300">Type</span>
                </div>
                <div className="text-xs capitalize text-gray-600 sm:text-sm dark:text-gray-400">
                  {details.governance_type.replace(/_/g, " ")}
                </div>
              </div>

              {details.deposit && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                    <span className="text-xs font-medium text-gray-700 sm:text-sm dark:text-gray-300">Deposit</span>
                  </div>
                  <div className="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
                    {(parseInt(details.deposit) / 1_000_000).toFixed(2)} ADA
                  </div>
                </div>
              )}

              {details.ratified_epoch && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                    <span className="text-xs font-medium text-gray-700 sm:text-sm dark:text-gray-300">Ratified Epoch</span>
                  </div>
                  <div className="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
                    {details.ratified_epoch}
                  </div>
                </div>
              )}

              {details.enacted_epoch && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                    <span className="text-xs font-medium text-gray-700 sm:text-sm dark:text-gray-300">Enacted Epoch</span>
                  </div>
                  <div className="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
                    {details.enacted_epoch}
                  </div>
                </div>
              )}

              {details.expiration && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                    <span className="text-xs font-medium text-gray-700 sm:text-sm dark:text-gray-300">Expires In</span>
                  </div>
                  <div className="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
                    {details.expiration} epochs
                  </div>
                </div>
              )}

              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-xs font-medium text-gray-700 sm:text-sm dark:text-gray-300">Transaction</span>
                </div>
                <div className="break-all font-mono text-xs text-gray-600 dark:text-gray-400">
                  {details.tx_hash}
                </div>
              </div>
            </div>
          )}

          {vote && voteDisplay && (
            <div className="border-b border-gray-200 pb-3 dark:border-gray-800">
              <h4 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Your Vote</h4>
              <div className="flex items-center gap-2">
                <VoteBadge voteKind={voteDisplay} prefix="Voted " />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Transaction: {vote.tx_hash.substring(0, 16)}... (cert index: {vote.cert_index})
                </span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-3">
            <VoteButton
              utxos={utxos}
              appWallet={appWallet}
              proposalId={proposalId}
              proposalTitle={proposal.json_metadata.body.title}
              selectedBallotId={selectedBallotId}
              proposalDetails={details}
              currentVote={voteDisplay}
            />
            <Link
              href={`/wallets/${appWallet.id}/governance/proposal/${proposal.tx_hash}:${proposal.cert_index}`}
              className="block"
            >
              <Button variant="outline" className="w-full text-sm">
                View Full Proposal
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function VoteBadge({
  voteKind,
  prefix = "",
}: {
  voteKind: "Yes" | "No" | "Abstain";
  prefix?: string;
}) {
  const config = {
    Yes: {
      icon: CheckCircle2,
      variant: "default" as const,
      className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
    },
    No: {
      icon: XCircle,
      variant: "destructive" as const,
      className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
    },
    Abstain: {
      icon: MinusCircle,
      variant: "secondary" as const,
      className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-800",
    },
  };

  const { icon: Icon, className } = config[voteKind];

  return (
    <Badge
      variant="outline"
      className={`flex items-center gap-1 text-xs ${className}`}
    >
      <Icon className="h-3 w-3" />
      <span>{prefix}{voteKind}</span>
    </Badge>
  );
}
