/**
 * Map over `items` with at most `limit` calls in flight, preserving order.
 *
 * For fan-out against rate-limited APIs (Blockfrost allows a burst of 500 and
 * 10/s sustained): one request at a time made a wallet with 400 transactions
 * wait for 400 round trips in series, while firing all of them at once would
 * burn the burst allowance on a single page load.
 *
 * Rejects with the first error, like Promise.all; callers that want partial
 * results catch per item inside `fn`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    worker,
  );
  await Promise.all(workers);
  return results;
}
