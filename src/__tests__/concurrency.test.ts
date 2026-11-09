import { describe, expect, it, jest } from "@jest/globals";

import { mapWithConcurrency } from "@/utils/concurrency";

describe("mapWithConcurrency", () => {
  // The global setup installs fake timers; these tests resolve on microtasks.
  const tick = () => Promise.resolve();

  it("keeps input order whatever order the calls finish in", async () => {
    const out = await mapWithConcurrency([30, 10, 20], 3, async (n) => {
      for (let i = 0; i < n; i++) await tick();
      return n * 2;
    });
    expect(out).toEqual([60, 20, 40]);
  });

  it("never has more than `limit` calls in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 25 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      await tick();
      inFlight--;
    });
    expect(peak).toBe(4);
  });

  it("handles an empty list and a limit larger than the list", async () => {
    expect(await mapWithConcurrency([], 8, async (x) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 8, async (x) => x + 1)).toEqual([2, 3]);
  });

  it("rejects on the first error and stops taking new work", async () => {
    const fn = jest.fn(async (n: number) => {
      await tick();
      if (n === 2) throw new Error("boom");
      return n;
    });
    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 2, fn),
    ).rejects.toThrow("boom");
    expect(fn.mock.calls.length).toBeLessThan(8);
  });
});
