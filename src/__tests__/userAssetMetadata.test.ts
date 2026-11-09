import { describe, expect, it, jest } from "@jest/globals";
import { createBlockfrostThrottle } from "@/utils/blockfrost-throttle";
import {
  USER_ASSET_METADATA_INTERVAL_MS,
  fetchUserAssetMetadata,
  toUserAssetMetadata,
  unitsNeedingMetadata,
} from "@/utils/user-asset-metadata";

/** A throttle that never waits, so the tests exercise ordering, not time. */
const instantThrottle = () =>
  createBlockfrostThrottle({
    minIntervalMs: 0,
    retryDelaysMs: [],
    sleep: async () => {},
  });

const NOT_FOUND = JSON.stringify({ data: {}, headers: {}, status: 404 });
const RATE_LIMITED = JSON.stringify({ data: {}, headers: {}, status: 429 });

describe("unitsNeedingMetadata", () => {
  it("skips lovelace, duplicates and units the store already names", () => {
    expect(
      unitsNeedingMetadata(["lovelace", "a", "b", "a", "c"], {
        b: { assetName: "B", decimals: 0 },
      }),
    ).toEqual(["a", "c"]);
  });

  it("does not treat inherited object keys as known units", () => {
    expect(unitsNeedingMetadata(["constructor", "toString"], {})).toEqual([
      "constructor",
      "toString",
    ]);
  });
});

describe("toUserAssetMetadata", () => {
  it("prefers registry metadata, then on-chain metadata, then the unit", () => {
    expect(
      toUserAssetMetadata("u1", {
        metadata: { name: "Registry", decimals: 6 },
        onchain_metadata: { name: "Onchain" },
      }),
    ).toEqual({ unit: "u1", assetName: "Registry", decimals: 6 });
    expect(
      toUserAssetMetadata("u2", { onchain_metadata: { name: "Onchain" } }),
    ).toEqual({ unit: "u2", assetName: "Onchain", decimals: 0 });
    expect(toUserAssetMetadata("u3", null)).toEqual({
      unit: "u3",
      assetName: "u3",
      decimals: 0,
    });
  });
});

describe("fetchUserAssetMetadata", () => {
  it("makes no request when every token is already named", async () => {
    const paths: string[] = [];
    const provider = {
      get: async (path: string) => {
        paths.push(path);
        return {};
      },
    };
    const entries = await fetchUserAssetMetadata(
      provider,
      ["lovelace", "a"],
      { a: { assetName: "A", decimals: 0 } },
      { throttle: instantThrottle() },
    );
    expect(entries).toEqual([]);
    expect(paths).toEqual([]);
  });

  it("looks up only the new tokens, once each", async () => {
    const paths: string[] = [];
    const provider = {
      get: async (path: string) => {
        paths.push(path);
        return { metadata: { name: path.slice("/assets/".length).toUpperCase() } };
      },
    };
    const entries = await fetchUserAssetMetadata(
      provider,
      ["lovelace", "a", "b", "b", "c"],
      { a: { assetName: "A", decimals: 0 } },
      { throttle: instantThrottle() },
    );
    expect(paths).toEqual(["/assets/b", "/assets/c"]);
    expect(entries).toEqual([
      { unit: "b", assetName: "B", decimals: 0 },
      { unit: "c", assetName: "C", decimals: 0 },
    ]);
  });

  it("overlaps lookups instead of waiting for each in turn", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const provider = {
      get: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return {};
      },
    };
    await fetchUserAssetMetadata(
      provider,
      ["a", "b", "c", "d", "e", "f"],
      {},
      { throttle: instantThrottle(), concurrency: 3 },
    );
    expect(maxInFlight).toBe(3);
  });

  it("leaves a failed lookup out so the token is retried next time", async () => {
    const provider = {
      get: async (path: string) => {
        if (path === "/assets/bad") throw NOT_FOUND;
        return { metadata: { name: "Good", decimals: 2 } };
      },
    };
    const entries = await fetchUserAssetMetadata(
      provider,
      ["bad", "good"],
      {},
      { throttle: instantThrottle() },
    );
    expect(entries).toEqual([{ unit: "good", assetName: "Good", decimals: 2 }]);
  });

  it("feeding the results back in as known makes the next run a no-op", async () => {
    let calls = 0;
    const provider = {
      get: async () => {
        calls++;
        return { metadata: { name: "X" } };
      },
    };
    const units = ["a", "b"];
    const first = await fetchUserAssetMetadata(provider, units, {}, {
      throttle: instantThrottle(),
    });
    const known = Object.fromEntries(first.map((entry) => [entry.unit, entry]));
    await fetchUserAssetMetadata(provider, units, known, {
      throttle: instantThrottle(),
    });
    expect(calls).toBe(2);
  });

  it("reports each name as soon as its own lookup resolves", async () => {
    const release: Record<string, () => void> = {};
    const provider = {
      get: (path: string) =>
        new Promise((resolve) => {
          release[path] = () => resolve({ metadata: { name: path } });
        }),
    };
    const seen: string[] = [];
    const done = fetchUserAssetMetadata(provider, ["slow", "fast"], {}, {
      throttle: instantThrottle(),
      onEntry: (entry) => seen.push(entry.unit),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release["/assets/fast"]!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // "fast" is reported while "slow" is still outstanding.
    expect(seen).toEqual(["fast"]);
    release["/assets/slow"]!();
    await done;
    expect(seen).toEqual(["fast", "slow"]);
  });

  it("joins a lookup another caller already has in flight", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const provider = {
      get: () =>
        new Promise((resolve) => {
          calls++;
          release = () => resolve({ metadata: { name: "Shared" } });
        }),
    };
    const a = fetchUserAssetMetadata(provider, ["shared"], {}, {
      throttle: instantThrottle(),
    });
    const b = fetchUserAssetMetadata(provider, ["shared"], {}, {
      throttle: instantThrottle(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(calls).toBe(1);
    expect(ra).toEqual([{ unit: "shared", assetName: "Shared", decimals: 0 }]);
    expect(rb).toEqual(ra);
  });

  it("does not join a lookup for the same unit on another network", async () => {
    let calls = 0;
    const releases: Array<() => void> = [];
    const provider = {
      get: () =>
        new Promise((resolve) => {
          calls++;
          releases.push(() => resolve({}));
        }),
    };
    const a = fetchUserAssetMetadata(provider, ["cross"], {}, {
      throttle: instantThrottle(),
      network: 0,
    });
    const b = fetchUserAssetMetadata(provider, ["cross"], {}, {
      throttle: instantThrottle(),
      network: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releases.forEach((release) => release());
    await Promise.all([a, b]);
    expect(calls).toBe(2);
  });

  it("paces lookups by default, one start per interval", async () => {
    jest.useFakeTimers({ now: 0 });
    try {
      const starts: number[] = [];
      const provider = {
        get: async () => {
          starts.push(Date.now());
          return {};
        },
      };
      const done = fetchUserAssetMetadata(provider, ["p1", "p2", "p3"], {});
      await jest.advanceTimersByTimeAsync(USER_ASSET_METADATA_INTERVAL_MS * 3);
      await done;
      expect(starts).toEqual([
        0,
        USER_ASSET_METADATA_INTERVAL_MS,
        USER_ASSET_METADATA_INTERVAL_MS * 2,
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops sending once Blockfrost keeps rate-limiting the batch", async () => {
    let calls = 0;
    const provider = {
      get: async () => {
        calls++;
        throw RATE_LIMITED;
      },
    };
    const entries = await fetchUserAssetMetadata(
      provider,
      ["r1", "r2", "r3", "r4", "r5", "r6"],
      {},
      { throttle: instantThrottle(), concurrency: 1 },
    );
    expect(entries).toEqual([]);
    // The throttle's breaker opens after 3 failures; the rest are not sent.
    expect(calls).toBe(3);
  });
});
