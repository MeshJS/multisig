import React, { useEffect, useState } from "react";
import BallotCard from "./ballot";
import type { UTxO } from "@meshsdk/core";
import { Vote, Minimize2 } from "lucide-react";

interface FloatingBallotSidebarProps {
  appWallet: any;
  selectedBallotId?: string;
  onSelectBallot: (id: string) => void;
  ballotCount: number;
  totalProposalCount: number;
  proposalCount: number;
  manualUtxos: UTxO[];
  /**
   * Optional controlled open state for the sidebar.
   * If provided together with onOpenChange, the sidebar becomes controlled.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional current proposal context (used on the proposal page).
   * When provided, the ballot card can show contextual UI like
   * an \"Add to ballot\" button and highlighting.
   */
  currentProposalId?: string;
  currentProposalTitle?: string;
}

export default function FloatingBallotSidebar({
  appWallet,
  selectedBallotId,
  onSelectBallot,
  ballotCount,
  totalProposalCount,
  proposalCount,
  manualUtxos,
  open: controlledOpen,
  onOpenChange,
  currentProposalId,
  currentProposalTitle,
}: FloatingBallotSidebarProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const isControlled = controlledOpen !== undefined && !!onOpenChange;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = (value: boolean | ((prev: boolean) => boolean)) => {
    if (isControlled && onOpenChange) {
      const next = typeof value === "function" ? value(open) : value;
      onOpenChange(next);
    } else {
      setUncontrolledOpen(value as boolean);
    }
  };

  useEffect(() => {
    function handleResize() {
      setIsMobile(
        typeof window !== "undefined" ? window.innerWidth < 768 : false,
      );
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
            {(ballotCount > 0 ||
              totalProposalCount > 0 ||
              proposalCount > 0) && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center h-4 w-4 rounded-full bg-red-600 text-white text-xs font-bold">
                {open
                  ? proposalCount > 0
                    ? proposalCount
                    : ""
                  : totalProposalCount > 0
                    ? totalProposalCount
                    : ""}
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
                currentProposalId={currentProposalId}
                currentProposalTitle={currentProposalTitle}
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
          title={
            open
              ? "Click to minimise ballot panel"
              : "Click to open ballot panel"
          }
          className={
            open
              ? "absolute -left-12 top-8 p-1.5 rounded-full bg-white/40 shadow border group text-gray-800 dark:text-white hover:bg-black hover:text-white"
              : "absolute top-0 right-0 p-1 group text-gray-800 dark:text-white"
          }
        >
          {open ? (
            <>
              <Vote
                size={32}
                className="block group-hover:hidden transition-colors"
              />
              <Minimize2
                size={32}
                className="hidden group-hover:block transition-colors"
              />
            </>
          ) : (
            <Vote size={40} />
          )}
          {(ballotCount > 0 ||
            totalProposalCount > 0 ||
            proposalCount > 0) && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center h-4 w-4 rounded-full bg-red-600 text-white text-xs font-bold">
              {open
                ? proposalCount > 0
                  ? proposalCount
                  : ""
                : totalProposalCount > 0
                  ? totalProposalCount
                  : ""}
            </span>
          )}
        </button>
        {open && (
          <div
            className="flex-1 min-h-0 overflow-y-auto scrollbar-hide"
            style={{ scrollbarWidth: "none" }}
          >
            <BallotCard
              appWallet={appWallet}
              selectedBallotId={selectedBallotId}
              onSelectBallot={onSelectBallot}
              utxos={manualUtxos}
              currentProposalId={currentProposalId}
              currentProposalTitle={currentProposalTitle}
            />
          </div>
        )}
      </div>
    </div>
  );
}


