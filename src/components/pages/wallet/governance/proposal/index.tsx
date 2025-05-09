import CardUI from "@/components/ui/card-content";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import RowLabelInfo from "@/components/common/row-label-info";
import { useSiteStore } from "@/lib/zustand/site";
import { ProposalMetadata } from "@/types/governance";
import { useEffect, useState } from "react";
import Link from "next/link";
import Button from "@/components/common/button";
import { useWalletsStore } from "@/lib/zustand/wallets";
import useAppWallet from "@/hooks/useAppWallet";
import VoteCard from "../vote-card";

export default function WalletGovernanceProposal({ id }: { id: string }) {
  const network = useSiteStore((state) => state.network);
  const [proposalMetadata, setProposalMetadata] = useState<
    ProposalMetadata | undefined
  >(undefined);
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const { appWallet } = useAppWallet();
  const loading = useSiteStore((state) => state.loading);

  useEffect(() => {
    const blockchainProvider = getProvider(network);
    async function get() {
      const [txHash, certIndex] = id.split(":");
      const proposalData = await blockchainProvider.get(
        `/governance/proposals/${txHash}/${certIndex}/metadata`,
      );

      if (proposalData) {
        setProposalMetadata(proposalData);
      }
    }
    get();
  }, []);


  if (!proposalMetadata) return <></>;

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <CardUI
        title={proposalMetadata.json_metadata.body.title}
        cardClassName="w-full"
        headerDom={
          network == 1 && (
            <div className="flex gap-4">
              <Button>
                <Link
                  href={`https://gov.tools/governance_actions/${proposalMetadata.tx_hash}#${proposalMetadata.cert_index}`}
                  target="_blank"
                >
                  GOV TOOL
                </Link>
              </Button>
              <Button>
                <Link
                  href={`https://adastat.net/governances/${proposalMetadata.tx_hash}0${proposalMetadata.cert_index}`}
                  target="_blank"
                >
                  ADASTAT
                </Link>
              </Button>
            </div>
          )
        }
      >
        <RowLabelInfo
          label="Authors"
          value={proposalMetadata.json_metadata.authors
            .map((author: any) => author.name)
            .join(", ")}
          allowOverflow={true}
        />

        <RowLabelInfo
          label="Abstract"
          value={proposalMetadata.json_metadata.body.abstract}
          allowOverflow={true}
        />

        <RowLabelInfo
          label="Motivation"
          value={proposalMetadata.json_metadata.body.motivation}
          allowOverflow={true}
        />

        <RowLabelInfo
          label="Rationale"
          value={proposalMetadata.json_metadata.body.rationale}
          allowOverflow={true}
        />
      </CardUI>
      {appWallet && <VoteCard appWallet={appWallet} proposalId={`${proposalMetadata.tx_hash}#${proposalMetadata.cert_index}`}/>}
    </main>
  );
}
