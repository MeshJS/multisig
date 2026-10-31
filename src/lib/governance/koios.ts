/**
 * Shared server-side Koios client helpers for the governance API routes.
 * Koios does not send CORS headers, so the browser can't call it directly —
 * routes under /api/governance proxy it (same pattern as /api/ipfs/resolve).
 * No API key is required for the public Koios tier.
 */

export const KOIOS_BASES: Record<string, string> = {
  "0": "https://preprod.koios.rest/api/v1", // network 0 = preprod (see getProvider)
  "1": "https://api.koios.rest/api/v1",
};

const TIMEOUT_MS = 15_000;
/** Koios public-tier page cap. */
const PAGE_SIZE = 500;
/** Hard stop so a pathological upstream can't keep us looping. */
const MAX_PAGES = 8;

export async function koiosGet<T>(url: string): Promise<T> {
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

export async function koiosPost<T>(url: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Koios responded ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function koiosGetAllPages<T>(baseUrl: string): Promise<T[]> {
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
export function normalizeProposalType(type: string | null | undefined): string | null {
  if (!type) return null;
  return type.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export function normalizeVote(vote: string): "Yes" | "No" | "Abstain" {
  const v = vote.trim().toLowerCase();
  if (v === "yes") return "Yes";
  if (v === "no") return "No";
  return "Abstain";
}

export type KoiosProposalTitleRow = {
  proposal_id: string;
  proposal_type: string | null;
  title: string | null;
  proposal_tx_hash: string;
  proposal_index: number;
};

/**
 * How long one proposal-title sweep is reused by default. A snapshot can be
 * missing a proposal submitted since it was taken; callers that find a vote
 * with no matching row ask again with PROPOSAL_TITLES_MISS_MAX_AGE_MS so a
 * new proposal gets its title within seconds, not minutes.
 */
export const PROPOSAL_TITLES_TTL_MS = 5 * 60_000;
/** Max snapshot age a caller accepts once it has seen a proposal the snapshot lacks. */
export const PROPOSAL_TITLES_MISS_MAX_AGE_MS = 30_000;

type ProposalTitleSnapshot = {
  rows: readonly KoiosProposalTitleRow[];
  /** When the sweep that produced `rows` started (ms since epoch). */
  fetchedAt: number;
};

const titleCache = new Map<string, ProposalTitleSnapshot>();
const titleInFlight = new Map<string, Promise<readonly KoiosProposalTitleRow[]>>();
/** Bumped by resetProposalTitleCache so a sweep started before a reset can't write after it. */
let titleGeneration = 0;

function sweepProposalTitleRows(base: string): Promise<KoiosProposalTitleRow[]> {
  return koiosGetAllPages<KoiosProposalTitleRow>(
    `${base}/proposal_list?select=proposal_id,proposal_type,title:meta_json->body->>title,proposal_tx_hash,proposal_index&order=proposal_id.asc`,
  );
}

export type ProposalTitleOptions = {
  /** Oldest snapshot (ms) the caller accepts. Defaults to PROPOSAL_TITLES_TTL_MS. */
  maxAgeMs?: number;
  now?: () => number;
};

/**
 * The full proposal list as title-only rows, for joining titles onto votes.
 * Small relative to filtering by voted ids, which would blow past URL
 * length limits for prolific voters. Ordered by proposal_id (stable +
 * unique) for consistent pagination; proposal_list rejects ordering by
 * columns outside the projection.
 *
 * The sweep is the same whichever DRep or transaction asked for it, and both
 * public governance routes (drepVotes, txGovernance) need it on most calls.
 * So it is shared per Koios base on this server instance: concurrent callers
 * join the sweep already in flight, and a finished one is reused while it is
 * younger than `maxAgeMs`.
 *
 * Failures are never cached — the next caller retries. When a refresh fails
 * but an older snapshot exists, that snapshot is returned instead: older
 * titles beat no titles, and the response carrying them may sit in a CDN for
 * a while. Rows (and the array) are frozen because every caller shares them.
 */
export function fetchProposalTitleRows(
  base: string,
  { maxAgeMs = PROPOSAL_TITLES_TTL_MS, now = Date.now }: ProposalTitleOptions = {},
): Promise<readonly KoiosProposalTitleRow[]> {
  const cached = titleCache.get(base);
  if (cached && now() - cached.fetchedAt < maxAgeMs) {
    return Promise.resolve(cached.rows);
  }

  // A sweep already running is at least as fresh as one we'd start now.
  const pending = titleInFlight.get(base);
  if (pending) return pending;

  const startedAt = now();
  const startedIn = titleGeneration;
  const promise = sweepProposalTitleRows(base)
    .then(
      (rows) => {
        const frozen = Object.freeze(rows.map((row) => Object.freeze(row)));
        if (startedIn === titleGeneration) {
          titleCache.set(base, { rows: frozen, fetchedAt: startedAt });
        }
        return frozen;
      },
      (error: unknown) => {
        const stale = startedIn === titleGeneration ? titleCache.get(base) : undefined;
        if (stale) {
          console.warn("koios: proposal title refresh failed; serving the previous snapshot:", error);
          return stale.rows;
        }
        throw error;
      },
    )
    .finally(() => {
      if (titleInFlight.get(base) === promise) titleInFlight.delete(base);
    });
  titleInFlight.set(base, promise);
  return promise;
}

/** Test hook: forget every cached and in-flight proposal-title sweep. */
export function resetProposalTitleCache(): void {
  titleGeneration++;
  titleCache.clear();
  titleInFlight.clear();
}
