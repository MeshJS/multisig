import { parseProposalId } from "@/lib/governance";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asRecord(value);
}

function isValidProposalId(id: string): boolean {
  try {
    parseProposalId(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Governance proposal ids (`<txHash>#<certIndex>`) a stored transaction votes
 * on. Understands both shapes the app persists in `Transaction.txJson`:
 * - client-built votes (direct and ballot): `votes[].vote.govActionId`
 * - bot proxy votes: `proxyBot.votes[].proposalId` when `proxyBot.kind === "proxyVote"`
 * Client-side proxy votes carry neither (the vote lives in a Plutus redeemer)
 * and yield an empty list. Order is preserved; duplicates are dropped.
 */
export function extractVoteProposalIds(txJson: unknown): string[] {
  const parsed = parseJsonRecord(txJson);
  if (!parsed) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id) || !isValidProposalId(id)) return;
    seen.add(id);
    ids.push(id);
  };

  if (Array.isArray(parsed.votes)) {
    for (const entry of parsed.votes) {
      const govActionId = asRecord(asRecord(asRecord(entry)?.vote)?.govActionId);
      if (
        typeof govActionId?.txHash === "string" &&
        typeof govActionId.txIndex === "number"
      ) {
        push(`${govActionId.txHash}#${govActionId.txIndex}`);
      }
    }
  }

  const proxyBot = asRecord(parsed.proxyBot);
  if (proxyBot?.kind === "proxyVote" && Array.isArray(proxyBot.votes)) {
    for (const entry of proxyBot.votes) {
      const proposalId = asRecord(entry)?.proposalId;
      if (typeof proposalId === "string") {
        push(proposalId);
      }
    }
  }

  return ids;
}
