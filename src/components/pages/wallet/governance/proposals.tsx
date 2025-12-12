import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/ui/card-content";
import { useEffect, useState } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from "remark-gfm";
import { getProvider } from "@/utils/get-provider";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";
import { useSiteStore } from "@/lib/zustand/site";
import { ProposalMetadata, ProposalDetails } from "@/types/governance";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import Link from "next/link";
import VoteButton from "./proposal/voteButtton";
import { UTxO } from "@meshsdk/core";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronUp, Clock, Calendar, Coins, Hash, FileText, Plus } from "lucide-react";
import { useProxy } from "@/hooks/useProxy";
import { useProxyData } from "@/lib/zustand/proxy";
import { useBallotModal } from "@/hooks/useBallotModal";

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

// Helper functions for proposal details
const getProposalStatus = (details?: ProposalDetails) => {
  if (!details) return null;
  if (details.enacted_epoch) return { label: "Enacted", icon: CheckCircle2, color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" };
  if (details.dropped_epoch) return { label: "Dropped", icon: XCircle, color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" };
  if (details.expired_epoch) return { label: "Expired", icon: XCircle, color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" };
  if (details.ratified_epoch) return { label: "Ratified", icon: CheckCircle2, color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" };
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
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
  const { openModal, setCurrentProposal } = useBallotModal();
  const count = 10;
  const order = "desc";

  // Get DRep ID for fetching voting history (proxy mode or standard mode)
  const standardDrepId = multisigWallet?.getKeysByRole(3) ? multisigWallet?.getDRepId() : appWallet?.dRepId;
  
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
          const txBuilder = getTxBuilder(network);
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
      }
      return newSet;
    });
  };


  const fetchProposalDetails = async (proposalId: string) => {
    const [txHash, certIndex] = proposalId.split("#");
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

  useEffect(() => {
    setProposals([]);
    setNextPage(1);
    setHasMore(true);
    setIsLoading(true);

    const blockchainProvider = getProvider(network);
    blockchainProvider.get(`/governance/proposals?count=${count}&page=1&order=${order}`)
      .then(async (proposalsData) => {
        const skeletons = proposalsData.map((p: any) => ({
          tx_hash: p.tx_hash,
          cert_index: Number(p.cert_index),
          governance_type: p.governance_type,
          hash: "",
          url: "",
          bytes: "",
          json_metadata: {
            body: {
              title: "Loading...",
              abstract: "Loading...",
              motivation: "",
              rationale: ""
            },
            authors: []
          }
        }));
        setProposals(skeletons);

        // Fetch both metadata and details in parallel for all proposals
        const proposalResponses = await Promise.all(proposalsData.map(async (p: any) => {
          const proposalId = p.tx_hash + "#" + p.cert_index;
          try {
            // Fetch both metadata and details in parallel
            // 404 for metadata is expected if proposal doesn't have metadata - handle silently
            const [metadata, details] = await Promise.all([
              blockchainProvider.get(`/governance/proposals/${p.tx_hash}/${p.cert_index}/metadata`).catch((err: any) => {
                const is404 = err?.response?.status === 404 || err?.data?.status_code === 404;
                if (is404) {
                  return null; // 404 is expected - proposal has no metadata
                }
                throw err; // Re-throw non-404 errors
              }),
              blockchainProvider.get(`/governance/proposals/${p.tx_hash}/${p.cert_index}`).catch(() => null)
            ]);

            // If metadata is null (404), use default structure
            if (!metadata) {
              return {
                key: proposalId,
                metadata: {
                  tx_hash: p.tx_hash,
                  cert_index: Number(p.cert_index),
                  governance_type: p.governance_type,
                  hash: "",
                  url: "",
                  bytes: "",
                  json_metadata: {
                    body: {
                      title: "Metadata not available",
                      abstract: "",
                      motivation: "",
                      rationale: "",
                      references: []
                    }
                  }
                },
                details: details as ProposalDetails | null
              };
            }

            return {
              key: proposalId,
              metadata: {
                ...metadata,
                governance_type: p.governance_type
              },
              details: details as ProposalDetails | null
            };
          } catch (e: any) {
            // If metadata fetch fails with non-404 error, try to still get details
            const details = await blockchainProvider.get(`/governance/proposals/${p.tx_hash}/${p.cert_index}`).catch(() => null);
            
            return {
              key: proposalId,
              metadata: {
                tx_hash: p.tx_hash,
                cert_index: Number(p.cert_index),
                governance_type: p.governance_type,
                hash: "",
                url: "",
                bytes: "",
                json_metadata: {
                  body: {
                    title: "Metadata could not be loaded.",
                    abstract: p.tx_hash + "#" + p.cert_index,
                    motivation: "",
                    rationale: ""
                  },
                  authors: []
                }
              },
              details: details as ProposalDetails | null
            };
          }
        }));

        // Update proposals with metadata
        setProposals(prev => {
          const updates = new Map(proposalResponses.map(res => [res.key, res.metadata]));
          return prev.map(p => {
            const key = p.tx_hash + "#" + p.cert_index;
            return updates.has(key) ? updates.get(key)! : p;
          });
        });

        // Update proposal details
        setProposalDetails(prev => {
          const newMap = new Map(prev);
          proposalResponses.forEach(res => {
            if (res.details) {
              newMap.set(res.key, res.details);
            }
          });
          return newMap;
        });

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
      const proposalsData: {
        tx_hash: string;
        cert_index: string;
        governance_type: string;
      }[] = await blockchainProvider.get(`/governance/proposals?count=${count}&page=${nextPage}&order=${order}`);

      // 1. Insert placeholder skeletons using just tx_hash, cert_index, and governance_type.
      const existingIds = new Set(proposals.map(p => p.tx_hash + "#" + p.cert_index));
      const newProposalsData = proposalsData.filter(p => !existingIds.has(p.tx_hash + "#" + p.cert_index));

      const skeletons: ProposalMetadata[] = newProposalsData.map(p => ({
        tx_hash: p.tx_hash,
        cert_index: Number(p.cert_index),
        governance_type: p.governance_type,
        hash: "",
        url: "",
        bytes: "",
        json_metadata: {
          body: {
            title: "Loading...",
            abstract: "Loading...",
            motivation: "",
            rationale: ""
          },
          authors: []
        }
      }));

      setProposals(prev => [...prev, ...skeletons]);

      // 2. Fetch metadata and details for all proposals in parallel
      const proposalResponses = await Promise.all(newProposalsData.map(async (p) => {
        const proposalId = p.tx_hash + "#" + p.cert_index;
        try {
          // Fetch both metadata and details in parallel
          const [metadata, details] = await Promise.all([
            blockchainProvider.get(`/governance/proposals/${p.tx_hash}/${p.cert_index}/metadata`),
            blockchainProvider.get(`/governance/proposals/${p.tx_hash}/${p.cert_index}`).catch(() => null)
          ]);

          return {
            key: proposalId,
            metadata: {
              ...metadata,
              governance_type: p.governance_type
            },
            details: details as ProposalDetails | null
          };
        } catch (e: any) {
          // If metadata fetch fails, try to still get details
          const details = await blockchainProvider.get(`/governance/proposals/${p.tx_hash}/${p.cert_index}`).catch(() => null);
          
          return {
            key: proposalId,
            metadata: {
              tx_hash: p.tx_hash,
              cert_index: Number(p.cert_index),
              governance_type: p.governance_type,
              hash: "",
              url: "",
              bytes: "",
              json_metadata: {
                body: {
                  title: "Metadata could not be loaded.",
                  abstract: p.tx_hash + "#" + p.cert_index,
                  motivation: "",
                  rationale: ""
                },
                authors: []
              }
            },
            details: details as ProposalDetails | null
          };
        }
      }));

      // 3. Update proposals with metadata
      setProposals(prev => {
        const updates = new Map(proposalResponses.map(res => [res.key, res.metadata]));
        return prev.map(p => {
          const key = p.tx_hash + "#" + p.cert_index;
          return updates.has(key) ? updates.get(key)! : p;
        });
      });

      // 4. Update proposal details
      setProposalDetails(prev => {
        const newMap = new Map(prev);
        proposalResponses.forEach(res => {
          if (res.details) {
            newMap.set(res.key, res.details);
          }
        });
        return newMap;
      });

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
          <div className="mb-2 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold mb-3 text-gray-900 dark:text-gray-100">
              {isProxyEnabled ? "Proxy DRep" : "DRep"} Voting Statistics
            </h3>
            {loadingVotes ? (
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <div className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"></div>
                Loading voting history...
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{votingStatistics.total}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Total Votes</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600 dark:text-green-400">{votingStatistics.yes}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Yes</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-red-600 dark:text-red-400">{votingStatistics.no}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">No</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-600 dark:text-gray-400">{votingStatistics.abstain}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Abstain</div>
                </div>
              </div>
            )}
          </div>
        )}
        {proposals.length > 0 && (
          <>
            {/* Desktop Table View */}
            <div className="hidden lg:block w-full">
              <Table className="w-full table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%] text-sm font-semibold align-top">Proposal</TableHead>
                    <TableHead className="w-[45%] text-sm font-semibold align-top">Abstract</TableHead>
                    <TableHead className="w-[15%] text-sm font-semibold align-top">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposals.map((proposal) => {
                    const proposalId = proposal.tx_hash + "#" + proposal.cert_index;
                    const vote = votes.get(proposalId);
                    const details = proposalDetails.get(proposalId);
                    const isLoadingDetails = loadingDetails.has(proposalId);
                    return (
                      <ProposalRow
                        key={proposalId}
                        proposal={proposal}
                        appWallet={appWallet}
                        utxos={utxos}
                        selectedBallotId={selectedBallotId}
                        vote={vote}
                        isExpanded={expandedProposals.has(proposalId)}
                        onToggle={() => toggleProposal(proposalId)}
                        details={details}
                        isLoadingDetails={isLoadingDetails}
                        setCurrentProposal={setCurrentProposal}
                        openModal={openModal}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile/Tablet Card View */}
            <div className="block lg:hidden space-y-3 sm:space-y-4">
              {proposals.map((proposal) => {
                const proposalId = proposal.tx_hash + "#" + proposal.cert_index;
                const vote = votes.get(proposalId);
                const isExpanded = expandedProposals.has(proposalId);
                const details = proposalDetails.get(proposalId);
                const isLoadingDetails = loadingDetails.has(proposalId);
                return (
                  <div
                    key={proposalId}
                    className="border rounded-lg shadow-sm bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow overflow-hidden"
                  >
                    {/* Collapsible Header */}
                    <button
                      onClick={() => toggleProposal(proposalId)}
                      className="w-full p-3 sm:p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 sm:gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-2 mb-2">
                            <h3 className="text-sm sm:text-base font-semibold break-words text-gray-900 dark:text-gray-100 leading-tight flex-1">
                              {proposal.json_metadata.body.title}
                            </h3>
                            {vote && (
                              <div className="flex-shrink-0 mt-0.5">
                                <VoteBadge voteKind={{
                                  "yes": "Yes" as const,
                                  "no": "No" as const,
                                  "abstain": "Abstain" as const
                                }[vote.vote]} />
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                            {details && getProposalStatus(details) && (() => {
                              const status = getProposalStatus(details)!;
                              const StatusIcon = status.icon;
                              return (
                                <div>
                                  <Badge className={`${status.color} flex items-center gap-1 w-fit`}>
                                    <StatusIcon className="h-3 w-3" />
                                    {status.label}
                                  </Badge>
                                </div>
                              );
                            })()}
                            <div>
                              <span className="font-medium">Type:</span>{" "}
                              <span className="font-semibold">
                                {proposal.governance_type.split("_").join(" ").toUpperCase()}
                              </span>
                            </div>
                            {proposal.json_metadata.authors.length > 0 && (
                              <div>
                                <span className="font-medium">Authors:</span>{" "}
                                <span className="break-words">
                                  {proposal.json_metadata.authors
                                    .map((author: any) => author.name)
                                    .join(", ")}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex-shrink-0 ml-2">
                          {isExpanded ? (
                            <ChevronUp className="h-5 w-5 text-gray-400" />
                          ) : (
                            <ChevronDown className="h-5 w-5 text-gray-400" />
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Expandable Content */}
                    {isExpanded && (
                      <div className="px-3 sm:px-4 pb-3 sm:pb-4 border-t border-gray-200 dark:border-gray-700 pt-3 sm:pt-4 space-y-3 sm:space-y-4">
                        {/* Abstract - Mobile only */}
                        <div>
                          <h4 className="text-xs sm:text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Abstract</h4>
                          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 prose prose-sm sm:prose-base max-w-none prose-headings:text-sm sm:prose-headings:text-base prose-p:text-xs sm:prose-p:text-sm prose-p:my-1 sm:prose-p:my-2">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {proposal.json_metadata.body.abstract}
                            </ReactMarkdown>
                          </div>
                        </div>

                        {/* Voting History */}
                        {vote && (
                          <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                            <h4 className="text-xs sm:text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Your Vote</h4>
                            <div className="flex flex-col gap-2">
                              <VoteBadge voteKind={{
                                "yes": "Yes" as const,
                                "no": "No" as const,
                                "abstain": "Abstain" as const
                              }[vote.vote]} />
                              <span className="text-xs text-gray-500 dark:text-gray-400 break-all">
                                Transaction: {vote.tx_hash.substring(0, 16)}... (cert index: {vote.cert_index})
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex flex-col gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                          <Link
                            href={`/wallets/${appWallet.id}/governance/proposal/${proposal.tx_hash}:${proposal.cert_index}`}
                            className="w-full"
                          >
                            <Button variant="outline" className="w-full text-sm sm:text-base py-2.5">
                              View Full Details
                            </Button>
                          </Link>
                          <Button
                            variant="default"
                            className="w-full text-sm bg-green-600 hover:bg-green-700 text-white py-2.5"
                            onClick={() => {
                              setCurrentProposal(proposalId, proposal.json_metadata.body.title);
                              openModal();
                            }}
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add to Ballot
                          </Button>
                          <VoteButton
                            utxos={utxos}
                            appWallet={appWallet}
                            proposalId={proposalId}
                            proposalTitle={proposal.json_metadata.body.title}
                            selectedBallotId={selectedBallotId}
                            proposalDetails={details}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
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
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p className="text-sm sm:text-base">No proposals found.</p>
          </div>
        )}
      </div>
    </CardUI>
  );
}

function ProposalRow({
  proposal,
  appWallet,
  utxos,
  selectedBallotId,
  vote,
  isExpanded,
  onToggle,
  details,
  isLoadingDetails,
  setCurrentProposal,
  openModal,
}: {
  proposal: ProposalMetadata;
  appWallet: Wallet;
  utxos: UTxO[];
  selectedBallotId?: string;
  vote?: VoteRecord;
  isExpanded?: boolean;
  onToggle?: () => void;
  details?: ProposalDetails;
  isLoadingDetails?: boolean;
  setCurrentProposal: (proposalId?: string, proposalTitle?: string) => void;
  openModal: () => void;
}): JSX.Element {
  const proposalId = proposal.tx_hash + "#" + proposal.cert_index;
  
  // Convert vote to display format
  const voteDisplay = vote ? {
    "yes": "Yes" as const,
    "no": "No" as const,
    "abstain": "Abstain" as const
  }[vote.vote] : undefined;
  
  return (
    <>
      <TableRow 
        className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
        onClick={onToggle}
      >
        <TableCell className="py-3 sm:py-4 w-[40%] align-top">
          <div className="space-y-2">
            {/* Title with badge and chevron */}
            <div className="flex items-start gap-2 min-w-0">
              <Link
                href={`/wallets/${appWallet.id}/governance/proposal/${proposal.tx_hash}:${proposal.cert_index}`}
                className="hover:underline break-words min-w-0 flex-1 text-sm font-medium leading-tight"
                onClick={(e) => e.stopPropagation()}
              >
                {proposal.json_metadata.body.title}
              </Link>
              <div className="flex items-center gap-1 flex-shrink-0">
                {voteDisplay && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <VoteBadge voteKind={voteDisplay} />
                  </div>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle?.();
                  }}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex-shrink-0"
                  aria-label={isExpanded ? "Collapse proposal" : "Expand proposal"}
                >
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>
            {/* Status, Type and Authors */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              {details && getProposalStatus(details) && (() => {
                const status = getProposalStatus(details)!;
                const StatusIcon = status.icon;
                return (
                  <div>
                    <Badge className={`${status.color} flex items-center gap-1 w-fit`}>
                      <StatusIcon className="h-3 w-3" />
                      {status.label}
                    </Badge>
                  </div>
                );
              })()}
              <div>
                <span className="font-medium">Type:</span>{" "}
                <span className="font-semibold">
                  {proposal.governance_type.split("_").join(" ").toUpperCase()}
                </span>
              </div>
              {proposal.json_metadata.authors.length > 0 && (
                <div>
                  <span className="font-medium">Authors:</span>{" "}
                  <span className="break-words">
                    {proposal.json_metadata.authors
                      .map((author: any) => author.name)
                      .join(", ")}
                  </span>
                </div>
              )}
            </div>
          </div>
        </TableCell>
        <TableCell className="prose prose-sm max-w-none whitespace-normal break-words text-sm py-3 sm:py-4 w-[45%] align-top">
          <div className={isExpanded ? "" : "line-clamp-2"}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {proposal.json_metadata.body.abstract}
            </ReactMarkdown>
          </div>
        </TableCell>
        <TableCell className="py-3 sm:py-4 w-[15%] align-top" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col items-end gap-2.5 min-w-0">
            {/* Voting Status Indicator */}
            {voteDisplay && (
              <div className="flex justify-end">
                <VoteBadge voteKind={voteDisplay} />
              </div>
            )}
            {/* Action Buttons - Right-aligned for table */}
            <div className="flex flex-col items-end gap-2">
              <VoteButton
                utxos={utxos}
                appWallet={appWallet}
                proposalId={proposalId}
                proposalTitle={proposal.json_metadata.body.title}
                selectedBallotId={selectedBallotId}
                proposalDetails={details}
              />
            </div>
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow className="bg-gray-50/50 dark:bg-gray-800/30">
          <TableCell colSpan={3} className="py-4 px-6">
            <div className="space-y-4">
              {/* Proposal Details */}
              {isLoadingDetails ? (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 pb-3 border-b border-gray-200 dark:border-gray-700">
                  <div className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"></div>
                  Loading details...
                </div>
              ) : details && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 pb-3 border-b border-gray-200 dark:border-gray-700">
                  {/* Governance Type */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-gray-500" />
                      <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Type</span>
                    </div>
                    <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 capitalize">
                      {details.governance_type.replace(/_/g, " ")}
                    </div>
                  </div>

                  {/* Deposit */}
                  {details.deposit && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Coins className="h-4 w-4 text-gray-500" />
                        <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Deposit</span>
                      </div>
                      <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        {(parseInt(details.deposit) / 1_000_000).toFixed(2)} ADA
                      </div>
                    </div>
                  )}

                  {/* Ratified Epoch */}
                  {details.ratified_epoch && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Ratified Epoch</span>
                      </div>
                      <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        {details.ratified_epoch}
                      </div>
                    </div>
                  )}

                  {/* Enacted Epoch */}
                  {details.enacted_epoch && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-gray-500" />
                        <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Enacted Epoch</span>
                      </div>
                      <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        {details.enacted_epoch}
                      </div>
                    </div>
                  )}

                  {/* Expiration */}
                  {details.expiration && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-gray-500" />
                        <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Expires In</span>
                      </div>
                      <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        {details.expiration} epochs
                      </div>
                    </div>
                  )}

                  {/* Transaction Hash */}
                  <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                    <div className="flex items-center gap-2">
                      <Hash className="h-4 w-4 text-gray-500" />
                      <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Transaction</span>
                    </div>
                    <div className="text-xs font-mono text-gray-600 dark:text-gray-400 break-all">
                      {details.tx_hash}
                    </div>
                  </div>
                </div>
              )}
              {/* Voting History */}
              {vote && (
                <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Your Vote</h4>
                  <div className="flex items-center gap-2">
                    <VoteBadge voteKind={voteDisplay!} />
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Transaction: {vote.tx_hash.substring(0, 16)}... (cert index: {vote.cert_index})
                    </span>
                  </div>
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="default"
                  className="w-full sm:w-auto text-sm bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => {
                    setCurrentProposal(proposalId, proposal.json_metadata.body.title);
                    openModal();
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add to Ballot
                </Button>
                <Link href={`/wallets/${appWallet.id}/governance/proposal/${proposal.tx_hash}:${proposal.cert_index}`}>
                  <Button variant="default" className="w-full sm:w-auto text-sm">
                    View Full Proposal
                  </Button>
                </Link>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function VoteBadge({ voteKind }: { voteKind: "Yes" | "No" | "Abstain" }) {
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
      className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700",
    },
  };

  const { icon: Icon, className } = config[voteKind];

  return (
    <Badge
      variant="outline"
      className={`flex items-center gap-1 text-xs ${className}`}
    >
      <Icon className="h-3 w-3" />
      <span>{voteKind}</span>
    </Badge>
  );
}