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
import CardUI from "@/components/common/card-content";
import { useEffect, useState } from "react";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
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

export default function AllProposals({ appWallet }: { appWallet: Wallet }) {
  const network = useSiteStore((state) => state.network);
  const [proposals, setProposals] = useState<ProposalMetadata[]>([]);
  const [limit, setLimit] = useState(5);

  useEffect(() => {
    async function load() {
      const blockchainProvider = getProvider(network);
      const proposals: {
        tx_hash: string;
        cert_index: string;
        governance_type: string;
      }[] = await blockchainProvider.get(`/governance/proposals`);

      const _proposals: ProposalMetadata[] = [];
      for (const proposal of proposals) {
        try {
          const proposalData = await blockchainProvider.get(
            `/governance/proposals/${proposal.tx_hash}/${proposal.cert_index}/metadata`,
          );
          // console.log("proposalData", proposalData);

          _proposals.push({
            ...proposalData,
            governance_type: proposal.governance_type,
          });
        } catch (e) {}
      }

      setProposals(_proposals);
    }
    load();
  }, []);

  const handleViewMore = () => {
    setLimit(limit + 5);
  };

  return (
    <CardUI
      title="Proposals"
      description={`All proposals submitted by the community`}
      // headerDom={
      //   <LinkCardanoscan
      //     url={`address/${appWallet.address}`}
      //     className="ml-auto gap-1"
      //   >
      //     <Button size="sm">
      //       View All
      //       <ArrowUpRight className="h-4 w-4" />
      //     </Button>
      //   </LinkCardanoscan>
      // }
      cardClassName="col-span-3"
    >
      <div className="flex flex-col gap-2">
        {proposals.length > 0 && (
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
              {proposals
                .slice(0)
                .reverse()
                .slice(0, limit)
                .map((proposal) => (
                  <ProposalRow
                    key={proposal.tx_hash}
                    proposal={proposal}
                    appWallet={appWallet}
                  />
                ))}
            </TableBody>
          </Table>
        )}
        {proposals.length > limit && (
          <div className="flex flex-row items-center gap-2">
            <Button variant="outline" onClick={handleViewMore}>
              + View More
            </Button>
            <p className="text-xs text-gray-500">
              Showing {limit} of {proposals.length}
            </p>
          </div>
        )}
      </div>
    </CardUI>
  );
}

function ProposalRow({
  proposal,
  appWallet,
}: {
  proposal: ProposalMetadata;
  appWallet: Wallet;
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
      <TableCell>{proposal.json_metadata.body.abstract}</TableCell>
      <TableCell>
        {proposal.governance_type.split("_").join(" ").toUpperCase()}
      </TableCell>
      <TableCell>
        <VoteButton
          appWallet={appWallet}
          proposalId={proposal.tx_hash + "#" + proposal.cert_index}
        />
      </TableCell>
    </TableRow>
  );
}

function Details({ proposal }: { proposal: ProposalMetadata }) {
  return (
    <Dialog>
      <DialogTrigger>{proposal.json_metadata.body.title}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{proposal.json_metadata.body.title}</DialogTitle>
          <DialogDescription>
            <div className="mt-4 flex flex-col gap-2">
              <h1 className="text-md font-semibold leading-none tracking-tight">
                Abstract
              </h1>
              <p>{proposal.json_metadata.body.abstract}</p>

              <h1 className="text-md font-semibold leading-none tracking-tight">
                Motivation
              </h1>
              <p>{proposal.json_metadata.body.motivation}</p>

              <h1 className="text-md font-semibold leading-none tracking-tight">
                Rationale
              </h1>
              <p>{proposal.json_metadata.body.rationale}</p>
            </div>
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
