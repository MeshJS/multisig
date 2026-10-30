import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  MAX_PAGES,
  PAGE_SIZE,
  TTL_MS,
  getLabel1854Registrations,
  resetLabel1854Cache,
  type Label1854Provider,
} from "@/lib/server/label1854Index";

/** A provider whose label holds `total` registrations, numbered from 0. */
function providerWith(total: number) {
  const get = jest.fn(async (path: string) => {
    const page = Number(/page=(\d+)/.exec(path)?.[1]);
    const start = (page - 1) * PAGE_SIZE;
    const end = Math.min(total, start + PAGE_SIZE);
    if (start >= total && page === 1) {
      throw { response: { data: { status_code: 404 } } };
    }
    return Array.from({ length: Math.max(0, end - start) }, (_, i) => ({
      n: start + i,
    }));
  });
  const provider: Label1854Provider = { get };
  return { provider, get };
}

beforeEach(() => {
  resetLabel1854Cache();
});

describe("getLabel1854Registrations", () => {
  it("pages until a short page and keeps the chain's oldest-first order", async () => {
    const { provider, get } = providerWith(250);

    const { items } = await getLabel1854Registrations(0, () => provider);

    expect(get).toHaveBeenCalledTimes(3);
    expect(items).toHaveLength(250);
    expect(items[0]).toEqual({ n: 0 });
    expect(items[249]).toEqual({ n: 249 });
  });

  it("stops at MAX_PAGES so one sweep's upstream cost stays bounded", async () => {
    const { provider, get } = providerWith(PAGE_SIZE * (MAX_PAGES + 5));

    const { items } = await getLabel1854Registrations(0, () => provider);

    expect(get).toHaveBeenCalledTimes(MAX_PAGES);
    expect(items).toHaveLength(PAGE_SIZE * MAX_PAGES);
  });

  it("treats a 404 on the first page as an empty label, and caches it", async () => {
    const { provider, get } = providerWith(0);

    const { items } = await getLabel1854Registrations(0, () => provider);
    expect(items).toEqual([]);
    await getLabel1854Registrations(0, () => provider);

    expect(get).toHaveBeenCalledTimes(1);
  });

  it("joins a sweep already in flight instead of starting another", async () => {
    const { provider, get } = providerWith(150);
    const getProvider = jest.fn(() => provider);

    const [a, b, c] = await Promise.all([
      getLabel1854Registrations(1, getProvider),
      getLabel1854Registrations(1, getProvider),
      getLabel1854Registrations(1, getProvider),
    ]);

    expect(getProvider).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
    expect(b.items).toBe(a.items);
    expect(c.items).toBe(a.items);
  });

  it("reuses a sweep for TTL_MS, then sweeps again", async () => {
    const { provider, get } = providerWith(10);
    let clock = 1_000_000;
    const now = () => clock;

    await getLabel1854Registrations(0, () => provider, now);
    clock += TTL_MS - 1;
    await getLabel1854Registrations(0, () => provider, now);
    expect(get).toHaveBeenCalledTimes(1);

    clock += 1;
    await getLabel1854Registrations(0, () => provider, now);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("caches each network separately", async () => {
    const mainnet = providerWith(3);
    const preprod = providerWith(5);

    const { items: one } = await getLabel1854Registrations(
      1,
      () => mainnet.provider,
    );
    const { items: zero } = await getLabel1854Registrations(
      0,
      () => preprod.provider,
    );

    expect(one).toHaveLength(3);
    expect(zero).toHaveLength(5);
    expect(mainnet.get).toHaveBeenCalledTimes(1);
    expect(preprod.get).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed sweep: the next caller retries", async () => {
    const get = jest
      .fn<(path: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("Blockfrost 503"))
      .mockResolvedValueOnce([{ n: 0 }]);
    const provider: Label1854Provider = { get };

    await expect(getLabel1854Registrations(0, () => provider)).rejects.toThrow(
      "Blockfrost 503",
    );
    const { items } = await getLabel1854Registrations(0, () => provider);
    expect(items).toEqual([{ n: 0 }]);
  });

  it("rejects a non-array page instead of caching garbage", async () => {
    const provider: Label1854Provider = {
      get: async () => ({ error: "unexpected" }),
    };

    await expect(getLabel1854Registrations(0, () => provider)).rejects.toThrow(
      "Invalid response format from provider",
    );
  });

  it("hands out a frozen array, so a caller can't add or drop shared entries", async () => {
    const { provider } = providerWith(2);

    const { items } = await getLabel1854Registrations(0, () => provider);

    expect(Object.isFrozen(items)).toBe(true);
  });
  it("dates a snapshot from when its sweep started, not when it finished", async () => {
    let clock = 5_000;
    const now = () => clock;
    const provider: Label1854Provider = {
      get: async () => {
        clock += 4_000; // a slow page
        return [];
      },
    };

    const { fetchedAt } = await getLabel1854Registrations(0, () => provider, now);

    expect(fetchedAt).toBe(5_000);
  });

  it("rejects, not throws, when the provider can't be built", async () => {
    const result = getLabel1854Registrations(0, () => {
      throw new Error("no Blockfrost key");
    });

    await expect(result).rejects.toThrow("no Blockfrost key");
  });

  it("drops a sweep that was in flight across a reset", async () => {
    let release: (value: unknown) => void = () => {};
    const slow: Label1854Provider = {
      get: () => new Promise((resolve) => (release = resolve)),
    };
    const stale = getLabel1854Registrations(0, () => slow);
    await Promise.resolve(); // let the sweep reach its first page request

    resetLabel1854Cache();
    const fresh = providerWith(1);
    await getLabel1854Registrations(0, () => fresh.provider);
    // The pre-reset sweep finishes last; it must not overwrite the fresh one.
    release([{ n: "stale" }]);
    await stale;

    const { items } = await getLabel1854Registrations(0, () => fresh.provider);
    expect(items).toEqual([{ n: 0 }]);
    expect(fresh.get).toHaveBeenCalledTimes(1);
  });
});
