/**
 * Display metadata (name, decimals) for the connected signer's own tokens.
 *
 * The connect-wallet flow used to look these up one `/assets/{unit}` call at a
 * time, for every token, every time the wallet's asset list changed. That is a
 * serial waterfall (a wallet with 40 tokens waited for 40 round trips before
 * the last name appeared), unpaced, and every re-run spent the site's shared
 * Blockfrost budget again on tokens it had already named. That budget (500
 * burst, 10/s sustained, per browser) is the one the wallet refresh and
 * transaction building also draw on.
 *
 * So here:
 *  - units already in the store are skipped (a token's registered name and
 *    decimals do not change within a session), as are duplicates and lovelace;
 *  - a unit already being looked up — by another connector on the page, or by
 *    a run whose effect has since re-run — is joined, not requested again;
 *  - the rest go through a Blockfrost throttle, a few in flight at a time, so
 *    they overlap round trips without bursting. A run starts at most 4 per
 *    second, so one run alongside the wallet refresh's own 5/s stays under the
 *    10/s limit;
 *  - each result is reported as it arrives, so names fill in progressively;
 *  - a failed lookup is left out rather than recorded, so the token keeps
 *    falling back to its unit and is tried again on the next run.
 */

import { mapWithConcurrency } from "@/utils/concurrency";
import { createBlockfrostThrottle } from "@/utils/blockfrost-throttle";

type Getter = { get: (path: string) => Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Throttle = ReturnType<typeof createBlockfrostThrottle>;

/** In flight at once; the throttle separately caps how fast they start. */
export const USER_ASSET_METADATA_CONCURRENCY = 4;
/** One start per 250 ms: 4/s, which plus the wallet refresh's 5/s is < 10/s. */
export const USER_ASSET_METADATA_INTERVAL_MS = 250;

export interface UserAssetMetadataEntry {
  unit: string;
  assetName: string;
  decimals: number;
}

/** The fields the store keeps, from a Blockfrost `/assets/{unit}` response. */
export function toUserAssetMetadata(
  unit: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assetInfo: any,
): UserAssetMetadataEntry {
  return {
    unit,
    assetName:
      assetInfo?.metadata?.name || assetInfo?.onchain_metadata?.name || unit,
    decimals: assetInfo?.metadata?.decimals || 0,
  };
}

/** The units that still need a lookup, in first-seen order. */
export function unitsNeedingMetadata(
  units: readonly string[],
  known: Readonly<Record<string, unknown>>,
): string[] {
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const unit of units) {
    if (unit === "lovelace" || seen.has(unit)) continue;
    seen.add(unit);
    if (Object.prototype.hasOwnProperty.call(known, unit)) continue;
    missing.push(unit);
  }
  return missing;
}

/**
 * Lookups in flight, by network and unit, shared by every caller. Settled
 * entries are removed, so this never caches a result (the store does) or a
 * failure. The network is part of the key so a run started after a network
 * switch never joins the old network's request.
 */
const inFlight = new Map<string, Promise<UserAssetMetadataEntry | null>>();

export async function fetchUserAssetMetadata(
  provider: Getter,
  units: readonly string[],
  known: Readonly<Record<string, unknown>>,
  options: {
    /** Keys the in-flight dedupe; pass the network the provider reads. */
    network?: number;
    /** Called once per successful lookup, as soon as it resolves. */
    onEntry?: (entry: UserAssetMetadataEntry) => void;
    throttle?: Throttle;
    concurrency?: number;
  } = {},
): Promise<UserAssetMetadataEntry[]> {
  const missing = unitsNeedingMetadata(units, known);
  if (missing.length === 0) return [];

  // Per call, not shared: once its breaker opens it refuses every later
  // lookup, which would leave the session's tokens unnamed for good.
  const throttle =
    options.throttle ??
    createBlockfrostThrottle({ minIntervalMs: USER_ASSET_METADATA_INTERVAL_MS });

  const lookup = (unit: string) => {
    const key = `${options.network ?? ""}:${unit}`;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = throttle
        .get(provider, `/assets/${unit}`)
        .then((info) => toUserAssetMetadata(unit, info))
        .catch(() => null)
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending;
  };

  const results = await mapWithConcurrency(
    missing,
    options.concurrency ?? USER_ASSET_METADATA_CONCURRENCY,
    async (unit) => {
      const entry = await lookup(unit);
      if (entry) options.onEntry?.(entry);
      return entry;
    },
  );
  return results.filter(
    (entry): entry is UserAssetMetadataEntry => entry !== null,
  );
}
