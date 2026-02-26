import type { ProposalDetails } from "@/types/governance";

export type ProposalStatus = "active" | "enacted" | "dropped" | "expired" | "ratified";
export type BallotChoice = "Yes" | "No" | "Abstain";

export function getProposalStatus(details?: ProposalDetails | null): ProposalStatus | null {
  if (!details) return null;
  if (details.enacted_epoch !== null) return "enacted";
  if (details.dropped_epoch !== null) return "dropped";
  if (details.expired_epoch !== null) return "expired";
  if (details.ratified_epoch !== null) return "ratified";
  return "active";
}

export function parseProposalId(id: string): { txHash: string; certIndex: number } {
  const [txHash, certIndexRaw, ...rest] = id.split("#");
  if (!txHash || certIndexRaw === undefined || rest.length > 0) {
    throw new Error("Invalid proposalId format. Expected <txHash>#<certIndex>");
  }

  const certIndex = Number(certIndexRaw);
  if (!Number.isInteger(certIndex) || certIndex < 0) {
    throw new Error("Invalid proposalId certIndex");
  }

  return { txHash, certIndex };
}

export function isValidChoice(choice: string): choice is BallotChoice {
  return choice === "Yes" || choice === "No" || choice === "Abstain";
}
