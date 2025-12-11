import CardInfo from "./card-info";
import { useSiteStore } from "@/lib/zustand/site";
import AllProposals from "./proposals";
import useAppWallet from "@/hooks/useAppWallet";
import VoteCard from "./vote-card";
import ClarityCard from "./clarity/card-clarity";
import VoteCC from "./cCommitee/voteCC";
import UTxOSelector from "../new-transaction/utxoSelector";
import type { UTxO } from "@meshsdk/core";
import { useState } from "react";
import { useBallot } from "@/hooks/useBallot";
import FloatingBallotSidebar from "./ballot/FloatingBallotSidebar";

export default function PageGovernance() {
  const { appWallet } = useAppWallet();
  const network = useSiteStore((state) => state.network);
  const [manualUtxos, setManualUtxos] = useState<UTxO[]>([]);
  const [manualSelected, setManualSelected] = useState(false);
  const [selectedBallotId, setSelectedBallotId] = useState<string | undefined>(undefined);

  const { ballots } = useBallot(appWallet?.id);
  const selected = ballots?.find((b) => b.id === selectedBallotId);
  const proposalCount = selected?.items?.length ?? 0;
  const totalProposalCount =
    ballots?.reduce(
      (sum, b) => sum + (Array.isArray(b.items) ? b.items.length : 0),
      0,
    ) ?? 0;

  if (appWallet === undefined) return <></>;
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      {/* Info section */}
      <CardInfo appWallet={appWallet} manualUtxos={manualUtxos} />
      
      {/* Proposals section right under info */}
      <AllProposals
        appWallet={appWallet}
        utxos={manualUtxos}
        selectedBallotId={selectedBallotId}
        onSelectBallot={setSelectedBallotId}
      />
      
      {/* Vote and Clarity cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <VoteCard appWallet={appWallet} utxos={manualUtxos} selectedBallotId={selectedBallotId} />
        <ClarityCard appWallet={appWallet} />
      </div>
      
      {/* Bottom section with UTxO selector */}
      <div className="flex flex-col gap-4">
        {appWallet && (
          <UTxOSelector
            appWallet={appWallet}
            network={network}
            onSelectionChange={(utxos, manual) => {
              setManualUtxos(utxos);
              setManualSelected(manual);
            }}
          />
        )}
        {false && (
          <VoteCC
            manualUtxos={manualUtxos}
            manualSelected={manualSelected}
            appWallet={appWallet}
            network={network}
          />
        )}
      </div>
      {/* Floating Ballot Sidebar */}
      <FloatingBallotSidebar
        appWallet={appWallet}
        selectedBallotId={selectedBallotId}
        onSelectBallot={setSelectedBallotId}
        ballotCount={ballots?.length ?? 0}
        totalProposalCount={totalProposalCount}
        proposalCount={proposalCount}
        manualUtxos={manualUtxos}
      />
    </main>
  );
}
