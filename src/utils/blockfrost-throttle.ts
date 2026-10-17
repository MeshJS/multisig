/**
 * Paced Blockfrost lookups for the browser.
 *
 * The browser reads Blockfrost with the site's public key, and Blockfrost
 * limits each client to 10 requests/s after a burst of 500. A wallet refresh
 * can issue several hundred lookups (one per transaction and per asset). Fired
 * as fast as the connection allows, they drain that burst, and every later
 * call from the same browser starts failing. That includes the protocol
 * parameters and UTxO calls that building a transaction needs.
 *
 * Blockfrost's 429 carries no CORS header, so the browser reports it as a
 * network error with no status. Both shapes count as "slow down" here.
 *
 * `createBlockfrostThrottle` returns a `get` that:
 *  - starts at most one request per `minIntervalMs` (default 8/s, below the
 *    sustained limit), so a refresh never drains the burst;
 *  - retries a rate-limited or network-failed lookup with backoff;
 *  - after `maxConsecutiveFailures` lookups in a row have failed, rejects the
 *    rest of the batch at once, without sending them. That leaves the remaining
 *    budget for the calls the user is actually waiting on.
 */

type Getter = { get: (path: string) => Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

export class BlockfrostThrottleOpenError extends Error {
  constructor() {
    super("Blockfrost lookups paused after repeated failures");
    this.name = "BlockfrostThrottleOpenError";
  }
}

/** Mesh's providers reject with a JSON string; see parseHttpError in @meshsdk/provider. */
export function isRetryableBlockfrostError(error: unknown): boolean {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  return (
    /"status":\s*429/.test(text) ||
    /"code":\s*"ERR_NETWORK"/.test(text) ||
    /Failed to fetch|NetworkError/i.test(text)
  );
}

export interface BlockfrostThrottleOptions {
  minIntervalMs?: number;
  retryDelaysMs?: number[];
  maxConsecutiveFailures?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function createBlockfrostThrottle(options: BlockfrostThrottleOptions = {}) {
  const minIntervalMs = options.minIntervalMs ?? 125;
  const retryDelaysMs = options.retryDelaysMs ?? [1000, 3000, 6000];
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? 3;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());

  let nextSlot = 0;
  let consecutiveFailures = 0;

  /** Reserve the next start slot; callers wait for it in reservation order. */
  async function waitForSlot() {
    const start = Math.max(now(), nextSlot);
    nextSlot = start + minIntervalMs;
    const wait = start - now();
    if (wait > 0) await sleep(wait);
  }

  async function get(provider: Getter, path: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let attempt = 0; ; attempt++) {
      if (consecutiveFailures >= maxConsecutiveFailures) {
        throw new BlockfrostThrottleOpenError();
      }
      await waitForSlot();
      try {
        const result = await provider.get(path);
        consecutiveFailures = 0;
        return result;
      } catch (error) {
        const delay = retryDelaysMs[attempt];
        if (isRetryableBlockfrostError(error) && delay !== undefined) {
          await sleep(delay);
          continue;
        }
        // A 404 or other definite answer is not a sign of rate limiting.
        if (isRetryableBlockfrostError(error)) consecutiveFailures++;
        throw error;
      }
    }
  }

  return { get };
}
