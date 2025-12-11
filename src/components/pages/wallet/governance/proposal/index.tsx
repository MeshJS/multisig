import CardUI from "@/components/ui/card-content";
import { getProvider } from "@/utils/get-provider";
import RowLabelInfo from "@/components/common/row-label-info";
import { useSiteStore } from "@/lib/zustand/site";
import type { ProposalMetadata } from "@/types/governance";
import { useEffect, useState } from "react";
import Link from "next/link";
import Button from "@/components/common/button";
import useAppWallet from "@/hooks/useAppWallet";
import VoteCard from "../vote-card";
import type { UTxO } from "@meshsdk/core";
import UTxOSelector from "../../new-transaction/utxoSelector";
import FloatingBallotSidebar from "../ballot/FloatingBallotSidebar";
import { useBallot } from "@/hooks/useBallot";

export default function WalletGovernanceProposal({ id }: { id: string }) {
  const network = useSiteStore((state) => state.network);
  const [proposalMetadata, setProposalMetadata] = useState<
    ProposalMetadata | undefined
  >(undefined);
  const { appWallet } = useAppWallet();
  const [manualUtxos, setManualUtxos] = useState<UTxO[]>([]);
  const [selectedBallotId, setSelectedBallotId] = useState<string | undefined>(
    undefined,
  );
  const [isBallotSidebarOpen, setIsBallotSidebarOpen] = useState(false);

  const { ballots } = useBallot(appWallet?.id);
  const selected = ballots?.find((b) => b.id === selectedBallotId);
  const proposalCount = selected?.items?.length ?? 0;
  const totalProposalCount =
    ballots?.reduce(
      (sum, b) => sum + (Array.isArray(b.items) ? b.items.length : 0),
      0,
    ) ?? 0;

  useEffect(() => {
    const blockchainProvider = getProvider(network);
    async function get() {
      const [txHash, certIndex] = id.split(":");
      const proposalData = (await blockchainProvider.get(
        `/governance/proposals/${txHash}/${certIndex}/metadata`,
      )) as ProposalMetadata;

      if (proposalData) {
        setProposalMetadata(proposalData);
      }
    }
    void get();
  }, [id, network]);

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
          value={(proposalMetadata.json_metadata.authors as { name: string }[])
            .map((author) => author.name)
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
      {appWallet && (
        <UTxOSelector
          appWallet={appWallet}
          network={network}
            onSelectionChange={(utxos) => {
              setManualUtxos(utxos);
            }}
        />
      )}
      {appWallet && (
        <VoteCard
          appWallet={appWallet}
          utxos={manualUtxos}
          proposalId={`${proposalMetadata.tx_hash}#${proposalMetadata.cert_index}`}
          selectedBallotId={selectedBallotId}
          proposalTitle={proposalMetadata.json_metadata.body.title}
          onOpenBallotSidebar={() => setIsBallotSidebarOpen(true)}
        />
      )}
      {appWallet && (
        <FloatingBallotSidebar
          appWallet={appWallet}
          selectedBallotId={selectedBallotId}
          onSelectBallot={setSelectedBallotId}
          ballotCount={ballots?.length ?? 0}
          totalProposalCount={totalProposalCount}
          proposalCount={proposalCount}
          manualUtxos={manualUtxos}
          open={isBallotSidebarOpen}
          onOpenChange={setIsBallotSidebarOpen}
          currentProposalId={`${proposalMetadata.tx_hash}#${proposalMetadata.cert_index}`}
          currentProposalTitle={proposalMetadata.json_metadata.body.title}
        />
      )}
    </main>
  );
}
