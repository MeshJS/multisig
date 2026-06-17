import { env } from "@/env";

/**
 * IPFS gateway helpers.
 *
 * The public `ipfs.io` gateway frequently returns 504s, so reads go through the
 * server-side `/api/ipfs/resolve` proxy which tries several gateways (our pinned
 * Pinata gateway first) with a short per-gateway timeout. Uploads return a
 * reliable Pinata gateway URL instead of `ipfs.io`.
 */

/** Pinata gateway base (scheme-qualified, no trailing slash, no `/ipfs`), or null. */
function pinataGateway(): string | null {
  let raw = env.NEXT_PUBLIC_PINATA_GATEWAY_URL?.trim();
  if (!raw) return null;
  // Accept a bare host (e.g. "id.mypinata.cloud") by normalising the scheme.
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  return raw.replace(/\/+$/, "").replace(/\/ipfs$/i, "");
}

/**
 * Extract the `cid[/path]` portion from a CID, an `ipfs://…` URL, or any
 * `…/ipfs/<cid>` gateway URL. Returns null if it doesn't look like IPFS.
 */
export function extractCidPath(input: string | undefined | null): string | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;
  if (s.startsWith("ipfs://")) s = s.replace(/^ipfs:\/\/(ipfs\/)?/i, "");
  // Take everything after the first "/ipfs/" segment, if present. A linear
  // indexOf (not a backtracking regex) so hostile inputs like
  // "/ipfs/a/ipfs/a/ipfs/a…" can't trigger polynomial ReDoS (CodeQL).
  const marker = "/ipfs/";
  const ipfsIdx = s.toLowerCase().indexOf(marker);
  if (ipfsIdx !== -1 && ipfsIdx + marker.length < s.length) {
    s = s.slice(ipfsIdx + marker.length);
  }
  s = s.split(/[?#]/)[0]!.replace(/^\/+/, "");
  if (!s || s.includes("..")) return null;
  const cid = s.split("/")[0]!;
  // CID-ish: base58 v0 (Qm…), base32 v1 (b…), or another long alphanumeric token.
  if (!/^[A-Za-z0-9]{20,}$/.test(cid)) return null;
  return s;
}

/** Ordered gateway bases (most reliable for our pinned content first). */
export function ipfsGatewayBases(): string[] {
  const bases: string[] = [];
  const pinata = pinataGateway();
  if (pinata) bases.push(`${pinata}/ipfs/`);
  bases.push("https://gateway.pinata.cloud/ipfs/");
  bases.push("https://ipfs.io/ipfs/");
  bases.push("https://dweb.link/ipfs/");
  bases.push("https://w3s.link/ipfs/");
  return [...new Set(bases)];
}

/** A reliable gateway URL for a freshly-pinned CID (used for on-chain anchors). */
export function ipfsGatewayUrl(cid: string): string {
  const pinata = pinataGateway();
  const base = pinata ? `${pinata}/ipfs/` : "https://gateway.pinata.cloud/ipfs/";
  return `${base}${cid}`;
}

/** App route that resolves an anchor (cid / ipfs:// / gateway url) server-side. */
export function ipfsResolveUrl(anchor: string): string {
  return `/api/ipfs/resolve?url=${encodeURIComponent(anchor)}`;
}

/** Hard backstop so a hung gateway can't leave a request pending forever. The
 * resolver itself tries up to 5 gateways at 6s each, so this sits above that. */
const FETCH_TIMEOUT_MS = 35000;

/**
 * Derive an AbortSignal that fires when either the caller's signal aborts or a
 * timeout elapses. Returns a cleanup to clear the timer / detach the listener.
 */
function timeoutSignal(
  signal: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), ms);
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * Fetch + parse JSON from an IPFS anchor. IPFS references go through the resolver
 * proxy (multi-gateway, server-side, no CORS); non-IPFS anchors are fetched
 * directly but restricted to https — an `http://localhost/…` or
 * `http://169.254.169.254/…` anchor (which a hostile co-signer could store) is
 * rejected rather than auto-fetched from the browser.
 */
export async function fetchIpfsJson<T = unknown>(
  anchor: string,
  signal?: AbortSignal,
): Promise<T> {
  const isIpfs = extractCidPath(anchor) !== null;
  let url: string;
  if (isIpfs) {
    url = ipfsResolveUrl(anchor);
  } else {
    let parsed: URL;
    try {
      parsed = new URL(anchor);
    } catch {
      throw new Error("Invalid rationale URL");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("Rationale URL must be https or an IPFS reference");
    }
    url = anchor;
  }

  const { signal: timed, cleanup } = timeoutSignal(signal, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: timed });
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) detail = `: ${body.error}`;
      } catch {
        // response body wasn't JSON; the status code alone will have to do
      }
      throw new Error(`Failed to fetch rationale (${res.status})${detail}`);
    }
    return (await res.json()) as T;
  } finally {
    cleanup();
  }
}
