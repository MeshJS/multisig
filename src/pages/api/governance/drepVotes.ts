import type { NextApiRequest, NextApiResponse } from "next";
import { applyRateLimit } from "@/lib/security/requestGuards";
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
 * directly; this route proxies it server-side (same pattern as
 * /api/ipfs/resolve). No API key is required for the public Koios tier.
 */

const KOIOS_BASES: Record<string, string> = {
  "0": "https://preprod.koios.rest/api/v1", // network 0 = preprod (see getProvider)
  "1": "https://api.koios.rest/api/v1",
};

const TIMEOUT_MS = 15_000;
/** Koios public-tier page cap. */
const PAGE_SIZE = 500;
/** Hard stop so a pathological upstream can't keep us looping. */
const MAX_PAGES = 8;

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

type KoiosProposalTitle = {
  proposal_id: string;
  proposal_type: string | null;
  title: string | null;
};

async function koiosGet<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Koios responded ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function koiosGetAllPages<T>(baseUrl: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const pageRows = await koiosGet<T[]>(
      `${baseUrl}${sep}limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
    );
    if (!Array.isArray(pageRows)) {
      throw new Error("Koios returned an unexpected payload");
    }
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }
  return rows;
}

/** Koios reports PascalCase types; the UI chips key on Blockfrost snake_case. */
function normalizeProposalType(type: string | null | undefined): string | null {
  if (!type) return null;
  return type.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function normalizeVote(vote: string): DrepVoteHistoryItem["vote"] {
  const v = vote.trim().toLowerCase();
  if (v === "yes") return "Yes";
  if (v === "no") return "No";
  return "Abstain";
}

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

    // Join proposal titles/types in one paginated sweep. The full proposal
    // list (title-only rows) is far smaller than filtering by the voted ids,
    // which would blow past URL length limits for prolific DReps.
    let titlesById = new Map<string, KoiosProposalTitle>();
    if (koiosVotes.length > 0) {
      try {
        // Order by proposal_id (stable + unique) for consistent pagination;
        // proposal_list rejects ordering by columns outside the projection.
        const titles = await koiosGetAllPages<KoiosProposalTitle>(
          `${base}/proposal_list?select=proposal_id,proposal_type,title:meta_json->body->>title&order=proposal_id.asc`,
        );
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
