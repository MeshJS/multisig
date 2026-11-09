import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  PROPOSAL_TITLES_MISS_MAX_AGE_MS,
  PROPOSAL_TITLES_TTL_MS,
  fetchProposalTitleRows,
  resetProposalTitleCache,
} from "@/lib/governance/koios";

/**
 * The proposal-title sweep behind the public governance routes is identical
 * whichever DRep or transaction asked for it, so it is shared per Koios base
 * on a server instance. These cases pin down what "shared" means: one sweep
 * in flight at a time, reuse for a bounded window, never reuse a failure.
 */

const MAINNET = "https://api.koios.rest/api/v1";
const PREPROD = "https://preprod.koios.rest/api/v1";

const row = (id: string) => ({
  proposal_id: id,
  proposal_type: "InfoAction",
  title: `Title ${id}`,
  proposal_tx_hash: "aa".repeat(32),
  proposal_index: 0,
});

type Deferred = { resolve: (body: unknown) => void; reject: (e: unknown) => void };

/** fetch mock whose responses the test releases by hand, in call order. */
function deferredFetch() {
  const pending: Deferred[] = [];
  global.fetch = jest.fn(
    () =>
      new Promise((resolve, reject) => {
        pending.push({
          resolve: (body) =>
            resolve({ ok: true, status: 200, json: async () => body }),
          reject,
        });
      }),
  ) as never;
  return pending;
}

function okFetch(body: unknown) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as never;
}

const fetchCalls = () => (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));

/** Let queued promise callbacks run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  resetProposalTitleCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("fetchProposalTitleRows", () => {
  it("joins concurrent callers onto one sweep", async () => {
    const pending = deferredFetch();

    const a = fetchProposalTitleRows(MAINNET);
    const b = fetchProposalTitleRows(MAINNET);
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    pending[0]!.resolve([row("gov_action1a")]);
    const [rowsA, rowsB] = await Promise.all([a, b]);

    expect(rowsA).toEqual([row("gov_action1a")]);
    expect(rowsB).toBe(rowsA);
  });

  it("reuses a finished sweep within the TTL, then sweeps again", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    okFetch([row("gov_action1a")]);

    await fetchProposalTitleRows(MAINNET, { now });
    clock += PROPOSAL_TITLES_TTL_MS - 1;
    await fetchProposalTitleRows(MAINNET, { now });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    clock += 1;
    await fetchProposalTitleRows(MAINNET, { now });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed sweep", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as never;
    await expect(fetchProposalTitleRows(MAINNET)).rejects.toThrow("Koios responded 503");

    okFetch([row("gov_action1a")]);
    await expect(fetchProposalTitleRows(MAINNET)).resolves.toEqual([row("gov_action1a")]);
  });

  it("keeps mainnet and preprod apart", async () => {
    global.fetch = jest.fn(async (input: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(input).startsWith(PREPROD) ? [row("gov_action1pre")] : [row("gov_action1main")],
    })) as never;

    const main = await fetchProposalTitleRows(MAINNET);
    const pre = await fetchProposalTitleRows(PREPROD);

    expect(main).toEqual([row("gov_action1main")]);
    expect(pre).toEqual([row("gov_action1pre")]);
    expect(fetchCalls().filter((u) => u.startsWith(PREPROD))).toHaveLength(1);
    expect(fetchCalls().filter((u) => u.startsWith(MAINNET))).toHaveLength(1);
  });

  it("hands out rows callers cannot mutate for each other", async () => {
    okFetch([row("gov_action1a")]);
    const rows = await fetchProposalTitleRows(MAINNET);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
  });

  it("sweeps again when a caller asks for a younger snapshot than the cached one", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    okFetch([row("gov_action1a")]);
    await fetchProposalTitleRows(MAINNET, { now });

    // Young enough for a vote on an unknown proposal: no new sweep.
    clock += PROPOSAL_TITLES_MISS_MAX_AGE_MS - 1;
    await fetchProposalTitleRows(MAINNET, { now, maxAgeMs: PROPOSAL_TITLES_MISS_MAX_AGE_MS });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Older than that, but well inside the default TTL: the miss forces one.
    clock += 1;
    await fetchProposalTitleRows(MAINNET, { now, maxAgeMs: PROPOSAL_TITLES_MISS_MAX_AGE_MS });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // ...and that sweep is what default callers now get.
    await fetchProposalTitleRows(MAINNET, { now });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("serves the previous snapshot when a refresh fails", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    okFetch([row("gov_action1a")]);
    await fetchProposalTitleRows(MAINNET, { now });

    clock += PROPOSAL_TITLES_TTL_MS;
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    })) as never;

    await expect(fetchProposalTitleRows(MAINNET, { now })).resolves.toEqual([
      row("gov_action1a"),
    ]);
    // The failure didn't refresh the timestamp: the next caller tries again.
    await fetchProposalTitleRows(MAINNET, { now });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("joins a refresh already in flight once the snapshot has expired", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    okFetch([row("gov_action1a")]);
    await fetchProposalTitleRows(MAINNET, { now });

    clock += PROPOSAL_TITLES_TTL_MS;
    const pending = deferredFetch();
    const a = fetchProposalTitleRows(MAINNET, { now });
    const b = fetchProposalTitleRows(MAINNET, { now });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    pending[0]!.resolve([row("gov_action1b")]);
    await expect(Promise.all([a, b])).resolves.toEqual([
      [row("gov_action1b")],
      [row("gov_action1b")],
    ]);
  });

  it("does not let a sweep started before a reset write after it", async () => {
    const pending = deferredFetch();
    const stale = fetchProposalTitleRows(MAINNET);
    await flush();

    resetProposalTitleCache();
    pending[0]!.resolve([row("gov_action1stale")]);
    await stale;

    // The next caller sweeps again instead of reading the stale result.
    const fresh = fetchProposalTitleRows(MAINNET);
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    pending[1]!.resolve([row("gov_action1fresh")]);
    await expect(fresh).resolves.toEqual([row("gov_action1fresh")]);
  });
});
