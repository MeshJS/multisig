export type ActiveProposal = {
  proposalId: string;
  title: string;
};

type GovernanceResponse = {
  proposals?: Array<{
    proposalId?: unknown;
    title?: unknown;
  }>;
};

export function getDeterministicActiveProposals(
  data: GovernanceResponse | unknown,
  maxItems = 2,
): ActiveProposal[] {
  const proposalsRaw = (data as GovernanceResponse | undefined)?.proposals;
  if (!Array.isArray(proposalsRaw)) {
    return [];
  }
  const proposals = proposalsRaw
    .map((proposal) => {
      const proposalId =
        typeof proposal?.proposalId === "string" ? proposal.proposalId.trim() : "";
      if (!proposalId) return null;
      const title =
        typeof proposal?.title === "string" && proposal.title.trim()
          ? proposal.title.trim()
          : proposalId;
      return {
        proposalId,
        title,
      };
    })
    .filter((proposal): proposal is ActiveProposal => Boolean(proposal))
    .sort((a, b) => a.proposalId.localeCompare(b.proposalId))
    .slice(0, Math.max(1, maxItems));

  return proposals;
}

export function buildBallotUpsertPayload(args: {
  walletId: string;
  ballotName: string;
  proposals: ActiveProposal[];
  secondPass?: boolean;
}): {
  walletId: string;
  ballotName: string;
  proposals: Array<{
    proposalId: string;
    proposalTitle: string;
    choice: "Yes" | "No";
    rationaleComment: string;
  }>;
} {
  const isSecondPass = Boolean(args.secondPass);
  return {
    walletId: args.walletId,
    ballotName: args.ballotName,
    proposals: args.proposals.map((proposal, index) => ({
      proposalId: proposal.proposalId,
      proposalTitle: proposal.title,
      choice: (isSecondPass ? (index % 2 === 0 ? "No" : "Yes") : index % 2 === 0 ? "Yes" : "No"),
      rationaleComment: `ci-route-chain ${isSecondPass ? "update" : "seed"} ${proposal.proposalId}`,
    })),
  };
}

