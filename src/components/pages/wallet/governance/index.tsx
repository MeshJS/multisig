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
import BallotModal from "./ballot/BallotModal";
import { BallotModalProvider, useBallotModal } from "@/hooks/useBallotModal";
import { Button } from "@/components/ui/button";
import { Vote } from "lucide-react";

function PageGovernanceContent() {
  const { appWallet } = useAppWallet();
  const network = useSiteStore((state) => state.network);
  const [manualUtxos, setManualUtxos] = useState<UTxO[]>([]);
  const [manualSelected, setManualSelected] = useState(false);
  const [selectedBallotId, setSelectedBallotId] = useState<string | undefined>(undefined);
  const { isOpen, closeModal, openModal, currentProposalId, currentProposalTitle } = useBallotModal();

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
    <>
      <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8 max-w-7xl mx-auto w-full">
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
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
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
      </main>
      
      {/* Floating Manage Ballots button (glassmorphism) */}
      <div className="fixed bottom-5 right-5 z-40">
        <Button
          onClick={openModal}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-white/70 dark:border-slate-700/80 shadow-[0_12px_30px_rgba(0,0,0,0.18)] text-sm font-semibold text-slate-800 dark:text-slate-50 transition-all duration-150 hover:-translate-y-[1px] hover:shadow-[0_16px_40px_rgba(0,0,0,0.22)] hover:border-white/80 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900"
        >
          <span className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-600 text-white shadow-inner shadow-blue-500/50 dark:bg-blue-500 dark:shadow-blue-400/60">
              <Vote className="h-3.5 w-3.5" />
            </span>
            <span className="truncate">Manage Ballots</span>
          </span>
          {proposalCount > 0 && (
            <span className="ml-1 text-xs font-bold text-slate-700 dark:text-slate-50 bg-slate-100/90 dark:bg-slate-800/90 px-2 py-0.5 rounded-full border border-slate-200/80 dark:border-slate-600">
              {proposalCount}
            </span>
          )}
        </Button>
      </div>
      
      {/* Ballot Modal */}
      {appWallet && (
        <BallotModal
          appWallet={appWallet}
          selectedBallotId={selectedBallotId}
          onSelectBallot={setSelectedBallotId}
          utxos={manualUtxos}
          open={isOpen}
          onOpenChange={closeModal}
          currentProposalId={currentProposalId}
          currentProposalTitle={currentProposalTitle}
          onBallotChanged={() => {
            // Refresh any necessary data
          }}
        />
      )}
    </>
  );
}

export default function PageGovernance() {
  return (
    <BallotModalProvider>
      <PageGovernanceContent />
    </BallotModalProvider>
  );
}
