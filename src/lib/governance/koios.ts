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
 * The full proposal list as title-only rows, for joining titles onto votes.
 * Small relative to filtering by voted ids, which would blow past URL
 * length limits for prolific voters. Ordered by proposal_id (stable +
 * unique) for consistent pagination; proposal_list rejects ordering by
 * columns outside the projection.
 */
export async function fetchProposalTitleRows(
  base: string,
): Promise<KoiosProposalTitleRow[]> {
  return koiosGetAllPages<KoiosProposalTitleRow>(
    `${base}/proposal_list?select=proposal_id,proposal_type,title:meta_json->body->>title,proposal_tx_hash,proposal_index&order=proposal_id.asc`,
  );
}
