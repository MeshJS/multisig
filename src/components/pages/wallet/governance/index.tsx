import CardInfo from "./card-info";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { useSiteStore } from "@/lib/zustand/site";
import AllProposals from "./proposals";
import useAppWallet from "@/hooks/useAppWallet";
import VoteCard from "./vote-card";
import ClarityCard from "./clarity/card-clarity";
import VoteCC from "./cCommitee/voteCC";
import UTxOSelector from "../new-transaction/utxoSelector";
import { UTxO } from "@meshsdk/core";
import BallotCard from "./ballot/ballot";
import { useState, useEffect, useMemo } from "react";
import { useBallot } from "@/hooks/useBallot";
import { Vote } from "lucide-react";

export default function PageGovernance() {
  const { appWallet } = useAppWallet();
  const network = useSiteStore((state) => state.network);
  const [manualUtxos, setManualUtxos] = useState<UTxO[]>([]);
  const [manualSelected, setManualSelected] = useState(false);
  const [selectedBallotId, setSelectedBallotId] = useState<string | undefined>(undefined);

  const { refresh, ballots } = useBallot(appWallet?.id);
  const selected = ballots?.find((b) => b.id === selectedBallotId);
  const proposalCount = selected?.items?.length ?? 0;

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
        proposalCount={proposalCount}
        manualUtxos={manualUtxos}
      />
    </main>
  );
}

// FloatingBallotSidebar component
interface FloatingBallotSidebarProps {
  appWallet: any;
  selectedBallotId?: string;
  onSelectBallot: (id: string) => void;
  ballotCount: number;
  proposalCount: number;
  manualUtxos: UTxO[];
}

function FloatingBallotSidebar({
  appWallet,
  selectedBallotId,
  onSelectBallot,
  ballotCount,
  proposalCount,
  manualUtxos
}: FloatingBallotSidebarProps) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function handleResize() {
      setIsMobile(typeof window !== "undefined" ? window.innerWidth < 768 : false);
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (isMobile) {
    return (
      <>
        <button
          className="fixed z-50 bottom-4 right-4 p-2 rounded-full bg-white/80 border shadow-md"
          onClick={() => setOpen(true)}
          aria-label="Open Ballots"
        >
          <div className="relative">
            <Vote size={32} className="text-gray-800 dark:text-white" />
            {(ballotCount > 0 || proposalCount > 0) && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center h-4 w-4 rounded-full bg-red-600 text-white text-xs font-bold">
                {proposalCount > 0 ? proposalCount : ""}
              </span>
            )}
          </div>
        </button>

        {open && (
          <div className="fixed z-50 left-0 bottom-0 w-full h-[85vh] bg-white dark:bg-gray-900 border-t p-4 shadow-xl animate-slideUp flex flex-col">
            <div className="flex justify-between items-center mb-2">
              <span className="font-semibold">Your Ballots</span>
              {proposalCount > 0 && (
                <span className="ml-2 inline-block text-xs font-medium text-white bg-blue-500 rounded-full px-2 py-0.5">
                  {proposalCount}
                </span>
              )}
              <button
                className="p-2 rounded-full hover:bg-gray-200"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <BallotCard
                appWallet={appWallet}
                selectedBallotId={selectedBallotId}
                onSelectBallot={onSelectBallot}
                utxos={manualUtxos}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className={`fixed z-50 bottom-4 right-4 transition-all duration-300 ${
        open ? "rounded-3xl max-w-md w-full md:w-[28rem] h-[50vh]" : "w-10 h-10"
      }`}
      style={{ pointerEvents: "auto" }}
    >
      <div
        className={`h-full flex flex-col transition-all duration-300
          ${open ? "px-4 py-6" : "p-2"}
        `}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse Ballots" : "Expand Ballots"}
          className={open ? "absolute -left-12 top-8 p-1.5 rounded-full bg-white/80 shadow hover:bg-gray-100 border" : "absolute top-0 right-0 p-1"}
        >
          <Vote size={40} />
          {(ballotCount > 0 || proposalCount > 0) && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center h-4 w-4 rounded-full bg-red-600 text-white text-xs font-bold">
                {proposalCount > 0 ? proposalCount : ''}
              </span>
            )}
        </button>
        {open && (
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
            <BallotCard
              appWallet={appWallet}
              selectedBallotId={selectedBallotId}
              onSelectBallot={onSelectBallot}
              utxos={manualUtxos}
            />
          </div>
        ) }
      </div>
    </div>
  );
}
