import type { ProxyVoteInput } from "@/lib/proxy/txBuilders";

/**
 * Request validation for proxy DRep votes (POST /api/v1/proxyVote).
 *
 * The shared `parseProposalId` is deliberately lenient (it backs UI parsing and
 * stored-data readers, where rejecting old rows would hide them). A vote we are
 * about to build into a transaction needs more than that:
 *
 * - a txHash that is not 32 bytes of hex cannot be encoded as a governance
 *   action id; it only fails inside `complete()`, after the handler has already
 *   resolved the wallet's UTxOs and collateral against Blockfrost, and surfaces
 *   as a 500 carrying a serializer message;
 * - two votes on the same action are worse: the ledger's voting procedures are
 *   a map keyed by (voter, action) and the proxy is a single DRep voter, so the
 *   CSL serializer this endpoint uses silently keeps one entry. The request used
 *   to return 201 with a transaction casting fewer votes than the request (and
 *   the stored `txJson.proxyBot.votes`) said;
 * - lenient index spellings (`#01`, `#1e0`, `# 1`) all parse to the same
 *   action, so duplicates have to be detected on the canonical form, and the
 *   canonical form is also what we persist in `txJson.proxyBot.votes`, where
 *   deadline reminders match it against Koios ids (lowercase hash, plain index).
 */

/**
 * Policy bound on votes per request. Each extra vote adds roughly 40 bytes to
 * the transaction (action id plus voting procedure; the proxy script and its
 * redeemer are paid once per voter), so a 16 KiB transaction tops out at a few
 * hundred votes. 256 sits just under that and far above any real ballot; it
 * exists so a 200 KB body of votes is refused up front instead of being built.
 */
export const MAX_PROXY_VOTES_PER_TX = 256;

/** Governance action indices are encoded as `uint .size 2` in the Conway CDDL. */
const MAX_GOV_ACTION_INDEX = 0xffff;

const PROPOSAL_ID_PATTERN = /^([0-9a-fA-F]{64})#(\d{1,5})$/;

/**
 * Canonical `<txHash>#<index>` for a proposal id, or null when the id cannot
 * name a governance action: lowercase hash, index without leading zeros.
 */
export function canonicalProposalId(raw: string): string | null {
  const match = PROPOSAL_ID_PATTERN.exec(raw.trim());
  if (!match) return null;
  const index = Number(match[2]);
  if (index > MAX_GOV_ACTION_INDEX) return null;
  return `${match[1]!.toLowerCase()}#${index}`;
}

export function validateProxyVotes(
  votes: unknown,
): ProxyVoteInput[] | { error: string } {
  if (!Array.isArray(votes) || votes.length === 0) {
    return { error: "votes must be a non-empty array" };
  }
  if (votes.length > MAX_PROXY_VOTES_PER_TX) {
    return {
      error: `votes may contain at most ${MAX_PROXY_VOTES_PER_TX} entries per transaction`,
    };
  }

  const normalized: ProxyVoteInput[] = [];
  const seen = new Set<string>();
  for (const [position, vote] of votes.entries()) {
    const candidate =
      typeof vote === "object" && vote !== null
        ? (vote as Partial<ProxyVoteInput>)
        : {};
    const rawId =
      typeof candidate.proposalId === "string" ? candidate.proposalId.trim() : "";
    if (!rawId) {
      return { error: `votes[${position}] requires proposalId` };
    }
    const proposalId = canonicalProposalId(rawId);
    if (!proposalId) {
      return {
        error: `votes[${position}].proposalId must be <txHash>#<index> with a 64-character hex txHash and an index from 0 to ${MAX_GOV_ACTION_INDEX}`,
      };
    }
    if (seen.has(proposalId)) {
      return {
        error: `votes[${position}] repeats proposal ${proposalId}; a DRep can cast only one vote per governance action in a transaction`,
      };
    }
    seen.add(proposalId);
    if (
      candidate.voteKind !== "Yes" &&
      candidate.voteKind !== "No" &&
      candidate.voteKind !== "Abstain"
    ) {
      return { error: `votes[${position}].voteKind must be Yes, No, or Abstain` };
    }
    normalized.push({
      proposalId,
      voteKind: candidate.voteKind,
      metadata: candidate.metadata,
    });
  }

  return normalized;
}
