import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import BallotCard from "./ballot";
import type { UTxO } from "@meshsdk/core";
import { Vote as VoteIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface BallotModalProps {
  appWallet: any;
  selectedBallotId?: string;
  onSelectBallot: (id: string) => void;
  utxos: UTxO[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional current proposal context (used on the proposal page).
   * When provided, the ballot card can show contextual UI like
   * an "Add to ballot" button and highlighting.
   */
  currentProposalId?: string;
  currentProposalTitle?: string;
  onBallotChanged?: () => void;
}

export default function BallotModal({
  appWallet,
  selectedBallotId,
  onSelectBallot,
  utxos,
  open,
  onOpenChange,
  currentProposalId,
  currentProposalTitle,
  onBallotChanged,
}: BallotModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800/50">
                  <VoteIcon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                </div>
                <DialogTitle className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  Manage Ballots
                </DialogTitle>
              </div>
              <DialogDescription className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Organize and vote on governance proposals
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 bg-gray-50/50 dark:bg-gray-900/50">
          <div className="max-w-full">
            <BallotCard
              appWallet={appWallet}
              selectedBallotId={selectedBallotId}
              onSelectBallot={onSelectBallot}
              utxos={utxos}
              currentProposalId={currentProposalId}
              currentProposalTitle={currentProposalTitle}
              onBallotChanged={() => {
                onBallotChanged?.();
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
