import { createContext, useContext, useState, ReactNode } from "react";

interface BallotModalContextType {
  isOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  currentProposalId?: string;
  currentProposalTitle?: string;
  setCurrentProposal: (proposalId?: string, proposalTitle?: string) => void;
}

const BallotModalContext = createContext<BallotModalContextType | undefined>(undefined);

export function BallotModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentProposalId, setCurrentProposalId] = useState<string | undefined>();
  const [currentProposalTitle, setCurrentProposalTitle] = useState<string | undefined>();

  const openModal = () => setIsOpen(true);
  const closeModal = () => {
    setIsOpen(false);
    // Clear proposal context when closing
    setCurrentProposalId(undefined);
    setCurrentProposalTitle(undefined);
  };

  const setCurrentProposal = (proposalId?: string, proposalTitle?: string) => {
    setCurrentProposalId(proposalId);
    setCurrentProposalTitle(proposalTitle);
  };

  return (
    <BallotModalContext.Provider
      value={{
        isOpen,
        openModal,
        closeModal,
        currentProposalId,
        currentProposalTitle,
        setCurrentProposal,
      }}
    >
      {children}
    </BallotModalContext.Provider>
  );
}

export function useBallotModal() {
  const context = useContext(BallotModalContext);
  if (context === undefined) {
    throw new Error("useBallotModal must be used within a BallotModalProvider");
  }
  return context;
}
