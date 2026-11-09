import { describe, expect, it, jest } from "@jest/globals";
import {
  BlockfrostThrottleOpenError,
  createBlockfrostThrottle,
  isRetryableBlockfrostError,
} from "@/utils/blockfrost-throttle";
import { mapWithConcurrency } from "@/utils/concurrency";

/** Virtual clock: sleep advances time instead of waiting. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

const RATE_LIMITED = JSON.stringify({ data: {}, headers: {}, status: 429 });
const CORS_BLOCKED = JSON.stringify({ code: "ERR_NETWORK", message: "Network Error" });
const NOT_FOUND = JSON.stringify({ data: {}, headers: {}, status: 404 });

describe("isRetryableBlockfrostError", () => {
  it("treats 429 and status-less network failures as rate limiting", () => {
    expect(isRetryableBlockfrostError(RATE_LIMITED)).toBe(true);
    expect(isRetryableBlockfrostError(CORS_BLOCKED)).toBe(true);
    expect(isRetryableBlockfrostError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableBlockfrostError(NOT_FOUND)).toBe(false);
  });
});

describe("createBlockfrostThrottle", () => {
  it("spaces request starts by minIntervalMs even when called in parallel", async () => {
    jest.useFakeTimers({ now: 0 });
    try {
      const starts: number[] = [];
      const throttle = createBlockfrostThrottle({ minIntervalMs: 200 });
      const provider = {
        get: async (path: string) => {
          starts.push(Date.now());
          return path;
        },
      };
      const pending = mapWithConcurrency([1, 2, 3, 4, 5], 4, (n) =>
        throttle.get(provider, `/p/${n}`),
      );
      await jest.advanceTimersByTimeAsync(2000);
      expect(await pending).toEqual(["/p/1", "/p/2", "/p/3", "/p/4", "/p/5"]);
      expect(starts).toEqual([0, 200, 400, 600, 800]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("retries a CORS-blocked 429 and succeeds", async () => {
    const clock = fakeClock();
    const throttle = createBlockfrostThrottle({ ...clock });
    let calls = 0;
    const provider = {
      get: async () => {
        calls++;
        if (calls < 3) throw CORS_BLOCKED;
        return "ok";
      },
    };
    await expect(throttle.get(provider, "/x")).resolves.toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry a definite answer such as 404", async () => {
    const throttle = createBlockfrostThrottle({ ...fakeClock() });
    let calls = 0;
    const provider = {
      get: async () => {
        calls++;
        throw NOT_FOUND;
      },
    };
    await expect(throttle.get(provider, "/x")).rejects.toBe(NOT_FOUND);
    expect(calls).toBe(1);
  });

  it("stops sending after repeated rate-limit failures", async () => {
    const throttle = createBlockfrostThrottle({
      retryDelaysMs: [],
      maxConsecutiveFailures: 3,
      ...fakeClock(),
    });
    let calls = 0;
    const provider = {
      get: async () => {
        calls++;
        throw RATE_LIMITED;
      },
    };
    const results = await mapWithConcurrency(
      Array.from({ length: 50 }, (_, i) => i),
      1,
      (i) => throttle.get(provider, `/t/${i}`).catch((e: unknown) => e),
    );
    expect(calls).toBe(3);
    expect(results.slice(3).every((r) => r instanceof BlockfrostThrottleOpenError)).toBe(true);
  });

  it("a success resets the failure streak", async () => {
    const throttle = createBlockfrostThrottle({
      retryDelaysMs: [],
      maxConsecutiveFailures: 2,
      ...fakeClock(),
    });
    const answers = [RATE_LIMITED, "ok", RATE_LIMITED, "ok"];
    const provider = {
      get: async () => {
        const next = answers.shift();
        if (next !== "ok") throw next;
        return next;
      },
    };
    const out: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      out.push(await throttle.get(provider, "/x").catch(() => "failed"));
    }
    expect(out).toEqual(["failed", "ok", "failed", "ok"]);
  });
});
