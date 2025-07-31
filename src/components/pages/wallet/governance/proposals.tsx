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
import { useSiteStore } from "@/lib/zustand/site";
import { ProposalMetadata } from "@/types/governance";
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

export default function AllProposals({ appWallet, utxos, selectedBallotId, onSelectBallot }: { appWallet: Wallet; utxos: UTxO[]; selectedBallotId?: string; onSelectBallot?: (id: string) => void }) {
  const network = useSiteStore((state) => state.network);
  const [proposals, setProposals] = useState<ProposalMetadata[]>([]);
  const [nextPage, setNextPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const count = 10;
  const order = "desc";

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

        const metadataResponses = await Promise.all(proposalsData.map(async (p: any) => {
          try {
            const metadata = await blockchainProvider.get(`/governance/proposals/${p.tx_hash}/${p.cert_index}/metadata`);
            return {
              key: p.tx_hash + "#" + p.cert_index,
              data: {
                ...metadata,
                governance_type: p.governance_type
              }
            };
          } catch (e: any) {
            return {
              key: p.tx_hash + "#" + p.cert_index,
              data: {
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
              }
            };
          }
        }));

        setProposals(prev => {
          const updates = new Map(metadataResponses.map(res => [res.key, res.data]));
          return prev.map(p => {
            const key = p.tx_hash + "#" + p.cert_index;
            return updates.has(key) ? updates.get(key)! : p;
          });
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

      // 2. Fetch metadata for all in parallel with Promise.all.
      const metadataResponses = await Promise.all(newProposalsData.map(async (p) => {
        try {
          const metadata = await blockchainProvider.get(
            `/governance/proposals/${p.tx_hash}/${p.cert_index}/metadata`
          );
          return {
            key: p.tx_hash + "#" + p.cert_index,
            data: {
              ...metadata,
              governance_type: p.governance_type
            }
          };
        } catch (e: any) {
            return {
              key: p.tx_hash + "#" + p.cert_index,
              data: {
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
              }
            };
        }
      }));

      // 3. Replace each skeleton in proposals once its metadata is loaded.
      setProposals(prev => {
        const updates = new Map(metadataResponses.filter(Boolean).map(res => [res!.key, res!.data]));
        return prev.map(p => {
          const key = p.tx_hash + "#" + p.cert_index;
          return updates.has(key) ? updates.get(key)! : p;
        });
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
      cardClassName="col-span-3"
    >
      <div className="flex flex-col gap-2">
        {proposals.length > 0 && (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Authors</TableHead>
                    <TableHead>Abstract</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposals.map((proposal) => (
                    <ProposalRow
                      key={proposal.tx_hash + "#" + proposal.cert_index}
                      proposal={proposal}
                      appWallet={appWallet}
                      utxos={utxos}
                      selectedBallotId={selectedBallotId}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Card View */}
            <div className="block md:hidden space-y-4">
              {proposals.map((proposal) => (
                <div
                  key={proposal.tx_hash + "#" + proposal.cert_index}
                  className="border rounded-lg p-4 shadow"
                >
                  <div className="text-sm font-semibold mb-1">
                    {proposal.json_metadata.body.title}
                  </div>
                  <div className="text-xs text-gray-500 mb-1">
                    Authors:{" "}
                    {proposal.json_metadata.authors
                      .map((author: any) => author.name)
                      .join(", ")}
                  </div>
                  <div className="text-xs text-gray-600 mb-2 prose prose-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {proposal.json_metadata.body.abstract}
                    </ReactMarkdown>
                  </div>
                  <div className="text-xs text-gray-700 mb-2">
                    Type:{" "}
                    {proposal.governance_type.split("_").join(" ").toUpperCase()}
                  </div>
                  <VoteButton
                    utxos={utxos}
                    appWallet={appWallet}
                    proposalId={proposal.tx_hash + "#" + proposal.cert_index}
                    proposalTitle={proposal.json_metadata.body.title}
                    selectedBallotId={selectedBallotId}
                  />
                </div>
              ))}
            </div>
          </>
        )}
        {hasMore && (
          <div className="flex flex-row items-center gap-2">
            <Button variant="outline" onClick={loadMore} disabled={isLoading}>
              {isLoading ? "Loading..." : "Load more"}
            </Button>
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
}: {
  proposal: ProposalMetadata;
  appWallet: Wallet;
  utxos: UTxO[];
  selectedBallotId?: string;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          href={`/wallets/${appWallet.id}/governance/proposal/${proposal.tx_hash}:${proposal.cert_index}`}
        >
          {proposal.json_metadata.body.title}
        </Link>
      </TableCell>
      <TableCell>
        {proposal.json_metadata.authors
          .map((author: any) => author.name)
          .join(", ")}
      </TableCell>
  <TableCell className="prose w-[70%] max-w-4xl whitespace-normal break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {proposal.json_metadata.body.abstract}
        </ReactMarkdown>
      </TableCell>
      <TableCell>
        {proposal.governance_type.split("_").join(" ").toUpperCase()}
      </TableCell>
      <TableCell>
        <VoteButton
          utxos={utxos}
          appWallet={appWallet}
          proposalId={proposal.tx_hash + "#" + proposal.cert_index}
          proposalTitle={proposal.json_metadata.body.title}
          selectedBallotId={selectedBallotId}
        />
      </TableCell>
    </TableRow>
  );
}