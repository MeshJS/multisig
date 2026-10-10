import type { NextApiRequest, NextApiResponse } from "next";
import { applyRateLimit } from "@/lib/security/requestGuards";
import {
  KOIOS_BASES,
  fetchProposalTitleRows,
  koiosGetAllPages,
  normalizeProposalType,
  normalizeVote,
  type KoiosProposalTitleRow,
} from "@/lib/governance/koios";
import type {
  DrepVoteHistoryItem,
  DrepVoteHistoryResponse,
} from "@/types/governance";

/**
 * DRep vote history, joined with proposal titles/types.
 *
 * Sourced from Koios rather than Blockfrost because Blockfrost's
 * `/governance/dreps/{id}/votes` returns neither the proposal a vote was cast
 * on nor the rationale anchor (meta_url/meta_hash) — both of which this page
 * is about. Koios does not send CORS headers, so the browser can't call it
 * directly; this route proxies it server-side (shared helpers in
 * `@/lib/governance/koios`).
 */

/** bech32 payload charset — also guarantees the id is URL-safe to embed. */
const DREP_ID_RE = /^drep1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,120}$/;

type KoiosDrepVote = {
  proposal_id: string;
  proposal_tx_hash: string;
  proposal_index: number;
  vote_tx_hash: string;
  block_time: number;
  vote: string;
  meta_url: string | null;
  meta_hash: string | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!applyRateLimit(req, res, { keySuffix: "drepVotes" })) return;

  const drepId = String(req.query.drepId ?? "").trim().toLowerCase();
  if (!DREP_ID_RE.test(drepId)) {
    return res.status(400).json({ error: "Invalid or missing drepId" });
  }
  const base = KOIOS_BASES[String(req.query.network ?? "")];
  if (!base) {
    return res.status(400).json({ error: "network must be 0 or 1" });
  }

  try {
    const koiosVotes = await koiosGetAllPages<KoiosDrepVote>(
      `${base}/drep_votes?_drep_id=${encodeURIComponent(drepId)}&order=block_time.desc`,
    );

    // Join proposal titles/types in one paginated sweep.
    let titlesById = new Map<string, KoiosProposalTitleRow>();
    if (koiosVotes.length > 0) {
      try {
        const titles = await fetchProposalTitleRows(base);
        titlesById = new Map(titles.map((t) => [t.proposal_id, t]));
      } catch (error) {
        // Titles are decoration — still return the votes without them.
        console.warn("drepVotes: proposal title join failed:", error);
      }
    }

    const votes: DrepVoteHistoryItem[] = koiosVotes
      .map((v) => {
        const proposal = titlesById.get(v.proposal_id);
        return {
          proposalId: v.proposal_id,
          proposalTxHash: v.proposal_tx_hash,
          proposalIndex: v.proposal_index,
          voteTxHash: v.vote_tx_hash,
          blockTime: v.block_time,
          vote: normalizeVote(v.vote),
          metaUrl: v.meta_url ?? null,
          metaHash: v.meta_hash ?? null,
          proposalType: normalizeProposalType(proposal?.proposal_type),
          proposalTitle: proposal?.title ?? null,
        };
      })
      .sort((a, b) => b.blockTime - a.blockTime);

    // Votes only ever append; let the CDN absorb repeat visits.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=3600",
    );
    const body: DrepVoteHistoryResponse = { drepId, votes };
    return res.status(200).json(body);
  } catch (error) {
    console.error("drepVotes: failed to fetch from Koios:", error);
    return res
      .status(502)
      .json({ error: "Could not fetch vote history from Koios" });
  }
}
