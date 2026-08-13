import type { NextApiRequest, NextApiResponse } from "next";
import { applyRateLimit } from "@/lib/security/requestGuards";
import {
  KOIOS_BASES,
  fetchProposalTitleRows,
  koiosPost,
  normalizeVote,
} from "@/lib/governance/koios";
import type {
  TxGovernanceItem,
  TxGovernanceResponse,
} from "@/types/governance";

/**
 * Governance activity (votes + governance certificates) per transaction,
 * from Koios `tx_info`. The token-flow timeline joins this against its tx
 * hashes to badge governance actions: Blockfrost exposes no per-tx endpoint
 * for votes or DRep certificates, and looking activity up by a KNOWN DRep
 * id misses per-run DReps (the CI test wallet registers, votes with, and
 * retires a fresh DRep every run). Koios has no CORS headers, so this
 * proxies server-side like /api/governance/drepVotes.
 *
 * Stake/pool certificates are deliberately excluded: the client already
 * badges those from Blockfrost's per-tx detail (`blockfrostCertBadges`),
 * and returning them here would double-badge.
 */

const TX_HASH_RE = /^[0-9a-f]{64}$/i;
const MAX_TX_HASHES = 500;
/**
 * Koios tx_info hashes per call. The public tier 413s on POST bodies over
 * ~5KB (measured 2026-08-13: 71 hashes passed, 75 failed) — 50 hashes is
 * ~3.5KB, a comfortable margin.
 */
const CHUNK_SIZE = 50;

const GOVERNANCE_CERT_TYPES = new Set([
  "drep_registration",
  "drep_retire",
  "drep_deregistration", // defensive alias; drep_retire is the observed string
  "drep_update",
  "vote_delegation",
  "stake_vote_delegation",
  "vote_reg_delegation",
  "stake_vote_reg_delegation",
  "auth_committee_hot",
  "resign_committee_cold",
]);

type KoiosTxInfoRow = {
  tx_hash: string;
  certificates?: Array<{
    index: number | null;
    type: string;
    info: Record<string, unknown> | null;
  }> | null;
  voting_procedures?: Array<{
    vote: string;
    voter: string;
    voter_role: string;
    proposal_index: number;
    proposal_tx_hash: string;
  }> | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!applyRateLimit(req, res, { keySuffix: "txGovernance" })) return;

  const { network, txHashes } = (req.body ?? {}) as {
    network?: unknown;
    txHashes?: unknown;
  };
  if (
    !Array.isArray(txHashes) ||
    txHashes.length > MAX_TX_HASHES ||
    txHashes.some((hash) => typeof hash !== "string" || !TX_HASH_RE.test(hash))
  ) {
    return res.status(400).json({
      error: `txHashes must be an array of up to ${MAX_TX_HASHES} tx hashes`,
    });
  }
  const base = KOIOS_BASES[String(network ?? "")];
  if (!base) {
    return res.status(400).json({ error: "network must be 0 or 1" });
  }

  const hashes = [...new Set(txHashes.map((hash) => hash.toLowerCase()))];
  if (hashes.length === 0) {
    const body: TxGovernanceResponse = { items: [] };
    return res.status(200).json(body);
  }

  try {
    const chunks: string[][] = [];
    for (let i = 0; i < hashes.length; i += CHUNK_SIZE) {
      chunks.push(hashes.slice(i, i + CHUNK_SIZE));
    }
    // Concurrent chunks: at most 10 POSTs (500-hash cap / 50), far under the
    // public tier's rate limit, and it keeps big timelines snappy.
    const chunkResults = await Promise.all(
      chunks.map((chunk) =>
        koiosPost<KoiosTxInfoRow[]>(`${base}/tx_info`, {
          _tx_hashes: chunk,
          _certs: true,
          _governance: true,
          _inputs: false,
          _metadata: false,
          _assets: false,
          _withdrawals: false,
          _scripts: false,
          _bytecode: false,
        }),
      ),
    );
    const rows: KoiosTxInfoRow[] = [];
    for (const chunkRows of chunkResults) {
      if (!Array.isArray(chunkRows)) {
        throw new Error("Koios returned an unexpected payload");
      }
      rows.push(...chunkRows);
    }

    const items: TxGovernanceItem[] = [];
    for (const row of rows) {
      const certs = (row.certificates ?? [])
        .filter((cert) => GOVERNANCE_CERT_TYPES.has(cert.type?.toLowerCase()))
        .map((cert) => ({
          type: cert.type.toLowerCase(),
          drepId:
            typeof cert.info?.drep_id === "string" ? cert.info.drep_id : null,
        }));
      const votes = (row.voting_procedures ?? []).map((vote) => ({
        voterRole: vote.voter_role,
        voteKind: normalizeVote(vote.vote),
        proposalTxHash: vote.proposal_tx_hash,
        proposalIndex: vote.proposal_index,
        proposalTitle: null as string | null,
      }));
      if (certs.length === 0 && votes.length === 0) continue;
      items.push({ txHash: row.tx_hash.toLowerCase(), certs, votes });
    }

    // Join proposal titles onto votes (decoration — best-effort).
    if (items.some((item) => item.votes.length > 0)) {
      try {
        const titleRows = await fetchProposalTitleRows(base);
        const titleByRef = new Map(
          titleRows.map((row) => [
            `${row.proposal_tx_hash.toLowerCase()}#${row.proposal_index}`,
            row.title,
          ]),
        );
        for (const item of items) {
          for (const vote of item.votes) {
            vote.proposalTitle =
              titleByRef.get(
                `${vote.proposalTxHash.toLowerCase()}#${vote.proposalIndex}`,
              ) ?? null;
          }
        }
      } catch (error) {
        console.warn("txGovernance: proposal title join failed:", error);
      }
    }

    const body: TxGovernanceResponse = { items };
    return res.status(200).json(body);
  } catch (error) {
    console.error("txGovernance: failed to fetch from Koios:", error);
    return res
      .status(502)
      .json({ error: "Could not fetch governance activity from Koios" });
  }
}
