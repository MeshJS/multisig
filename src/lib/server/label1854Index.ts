/**
 * The chain's CIP-0146 (metadata label 1854) registrations, swept once and
 * shared by every lookup on this server instance.
 *
 * /api/v1/lookupMultisigWallet answers "which registrations list any of these
 * key hashes?". Blockfrost can't filter label metadata by content, so every
 * lookup has to page through the whole label — and that sweep is identical
 * whatever hashes were asked for. Before this module each request ran its own
 * serial sweep (up to MAX_PAGES Blockfrost calls), so the discover tab, the
 * wallet-registration badge and MCP lookups fired by the same people seconds
 * apart each paid the full waterfall, and a public, unauthenticated endpoint
 * spent up to MAX_PAGES upstream requests per call.
 *
 * Now concurrent callers join the sweep already in flight, and a finished
 * sweep is reused for TTL_MS, counted from when the sweep started. The
 * endpoint passes `fetchedAt` on so its HTTP `max-age` covers only what is
 * left of the TTL — otherwise server and browser caches would stack and a new
 * registration could take two TTLs to show up.
 *
 * Failures are never cached: the next caller retries the sweep. A 404 is not
 * a failure — Blockfrost answers 404 for a label (or page) with no entries —
 * so it ends the sweep like a short page does.
 */

import { isProviderNotFoundError } from "@/lib/server/providerErrors";

/** Blockfrost returns label metadata oldest first, 100 per page at most. */
export const PAGE_SIZE = 100;
/** Bounds the upstream fan-out of one sweep. */
export const MAX_PAGES = 10;
export const TTL_MS = 60_000;

export type Label1854Provider = {
  get: (path: string) => Promise<unknown>;
};

export type Label1854Snapshot = {
  /** Registrations, oldest first. Shared between callers: don't mutate. */
  items: readonly unknown[];
  /** When the sweep that produced `items` started (ms since epoch). */
  fetchedAt: number;
};

const cache = new Map<number, Label1854Snapshot>();
const inFlight = new Map<number, Promise<Label1854Snapshot>>();
/** Bumped by resetLabel1854Cache so a sweep started before a reset can't write after it. */
let generation = 0;

async function sweep(provider: Label1854Provider): Promise<readonly unknown[]> {
  const items: unknown[] = [];
  // Serial on purpose: the page count is unknown until a short page arrives,
  // and ascending order must be preserved so consumers can treat the first
  // match as the original registration.
  for (let page = 1; page <= MAX_PAGES; page++) {
    let batch: unknown;
    try {
      batch = await provider.get(
        `/metadata/txs/labels/1854?page=${page}&count=${PAGE_SIZE}`,
      );
    } catch (error) {
      if (isProviderNotFoundError(error)) break;
      throw error;
    }
    if (!Array.isArray(batch)) {
      throw new Error("Invalid response format from provider");
    }
    items.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return Object.freeze(items);
}

/**
 * All label-1854 registrations on `networkId`, oldest first, with the time
 * the sweep that produced them started.
 *
 * `getProvider` is only called when a sweep actually runs.
 */
export function getLabel1854Registrations(
  networkId: number,
  getProvider: () => Label1854Provider,
  now: () => number = Date.now,
): Promise<Label1854Snapshot> {
  const cached = cache.get(networkId);
  if (cached && now() - cached.fetchedAt < TTL_MS) {
    return Promise.resolve(cached);
  }

  const pending = inFlight.get(networkId);
  if (pending) return pending;

  const startedAt = now();
  const startedIn = generation;
  // Promise.resolve().then: a throwing getProvider rejects like any other
  // failure instead of escaping synchronously.
  const run: Promise<Label1854Snapshot> = Promise.resolve()
    .then(() => sweep(getProvider()))
    .then((items) => {
      const snapshot = { items, fetchedAt: startedAt };
      if (startedIn === generation) cache.set(networkId, snapshot);
      return snapshot;
    })
    .finally(() => {
      if (inFlight.get(networkId) === run) inFlight.delete(networkId);
    });
  inFlight.set(networkId, run);
  return run;
}

/** Test hook: forget every cached and in-flight sweep. */
export function resetLabel1854Cache(): void {
  generation++;
  cache.clear();
  inFlight.clear();
}
