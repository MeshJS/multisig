/**
 * A DRep's own voting record, as the wallet governance page shows it: which
 * way the DRep voted on each proposal, plus Yes/No/Abstain totals.
 *
 * Kept out of the component so the record is built (and tested) in one place,
 * and so the fetch can be abandoned when the DRep it was started for is no
 * longer the one on screen — see `fetchDRepVoteRows`' `isCurrent`.
 */

export type DRepVoteRecord = {
  tx_hash: string;
  cert_index: number;
  vote: "yes" | "no" | "abstain";
  proposal_tx_hash: string;
  proposal_cert_index: number;
  proposal_id: string;
};

export type DRepVotingStatistics = {
  total: number;
  yes: number;
  no: number;
  abstain: number;
};

/** Blockfrost `/governance/dreps/{id}/votes` row (only the fields we read). */
export type BlockfrostDRepVote = {
  tx_hash: string;
  cert_index: number;
  vote?: string | null;
  proposal_tx_hash: string;
  proposal_cert_index: number;
  proposal_id: string;
};

export const EMPTY_DREP_VOTING_STATISTICS: DRepVotingStatistics = Object.freeze({
  total: 0,
  yes: 0,
  no: 0,
  abstain: 0,
});

/**
 * Index votes by `<proposal tx hash>#<cert index>` (the id the proposal list
 * uses) and count them. Rows arrive oldest first, so a later vote on the same
 * proposal replaces the earlier one in the map — and must replace it in the
 * totals too, or a DRep who changed their vote is counted twice.
 */
export function summarizeDRepVotes(rows: readonly BlockfrostDRepVote[]): {
  votes: Map<string, DRepVoteRecord>;
  statistics: DRepVotingStatistics;
} {
  const votes = new Map<string, DRepVoteRecord>();
  for (const row of rows) {
    const key = `${row.proposal_tx_hash}#${row.proposal_cert_index}`;
    votes.set(key, {
      tx_hash: row.tx_hash,
      cert_index: row.cert_index,
      vote: (row.vote ?? "").toLowerCase() as DRepVoteRecord["vote"],
      proposal_tx_hash: row.proposal_tx_hash,
      proposal_cert_index: row.proposal_cert_index,
      proposal_id: row.proposal_id,
    });
  }

  const statistics = { ...EMPTY_DREP_VOTING_STATISTICS };
  for (const record of votes.values()) {
    statistics.total++;
    if (record.vote === "yes") statistics.yes++;
    else if (record.vote === "no") statistics.no++;
    else if (record.vote === "abstain") statistics.abstain++;
  }
  return { votes, statistics };
}

const PAGE_SIZE = 100;
/** 50 pages = 5,000 votes: far beyond any DRep today, but a hard stop if the
 * provider ever keeps returning full pages. */
const MAX_PAGES = 50;

/**
 * Fetch every vote of a CIP-105 DRep id, page by page.
 *
 * `isCurrent` is checked between pages: once it returns false the result can
 * no longer be shown, so the remaining pages are not requested and `null` is
 * returned. Without this, switching between the wallet's own DRep and a proxy
 * DRep raced two paginated fetches and whichever finished last — usually the
 * DRep with the longer history — overwrote the record on screen.
 */
export async function fetchDRepVoteRows(
  get: (path: string) => Promise<unknown>,
  cip105DrepId: string,
  isCurrent: () => boolean = () => true,
): Promise<BlockfrostDRepVote[] | null> {
  const rows: BlockfrostDRepVote[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (!isCurrent()) return null;
    const data = await get(
      `/governance/dreps/${cip105DrepId}/votes?count=${PAGE_SIZE}&page=${page}&order=asc`,
    );
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...(data as BlockfrostDRepVote[]));
    if (data.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) {
      // Oldest first, so what the cap drops are the newest votes.
      console.warn(`DRep vote history truncated at ${MAX_PAGES * PAGE_SIZE} votes`, cip105DrepId);
    }
  }
  return isCurrent() ? rows : null;
}
