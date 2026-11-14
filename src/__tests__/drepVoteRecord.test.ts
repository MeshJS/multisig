import { describe, expect, it, jest } from "@jest/globals";
import {
  fetchDRepVoteRows,
  summarizeDRepVotes,
  type BlockfrostDRepVote,
} from "@/lib/governance/drep-votes";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function row(
  proposalTxHash: string,
  certIndex: number,
  vote: string,
  txHash = "f".repeat(64),
): BlockfrostDRepVote {
  return {
    tx_hash: txHash,
    cert_index: 0,
    vote,
    proposal_tx_hash: proposalTxHash,
    proposal_cert_index: certIndex,
    proposal_id: `gov_action_${proposalTxHash.slice(0, 4)}${certIndex}`,
  };
}

function page(length: number, offset = 0): BlockfrostDRepVote[] {
  return Array.from({ length }, (_, i) => row(HASH_A, offset + i, "yes"));
}

describe("summarizeDRepVotes", () => {
  it("indexes each vote by the proposal id the list uses and counts it", () => {
    const { votes, statistics } = summarizeDRepVotes([
      row(HASH_A, 0, "Yes"),
      row(HASH_A, 1, "no"),
      row(HASH_B, 0, "abstain"),
    ]);

    expect(votes.get(`${HASH_A}#0`)?.vote).toBe("yes");
    expect(votes.get(`${HASH_A}#1`)?.vote).toBe("no");
    expect(votes.get(`${HASH_B}#0`)?.vote).toBe("abstain");
    expect(statistics).toEqual({ total: 3, yes: 1, no: 1, abstain: 1 });
  });

  it("counts a changed vote once, as the latest vote", () => {
    // Rows come oldest first. The map kept the latest vote while the totals
    // used to count both rows, so a DRep who switched No→Yes showed 2 votes.
    const { votes, statistics } = summarizeDRepVotes([
      row(HASH_A, 0, "no", "1".repeat(64)),
      row(HASH_A, 0, "yes", "2".repeat(64)),
    ]);

    expect(votes.size).toBe(1);
    expect(votes.get(`${HASH_A}#0`)).toMatchObject({ vote: "yes", tx_hash: "2".repeat(64) });
    expect(statistics).toEqual({ total: 1, yes: 1, no: 0, abstain: 0 });
  });

  it("returns an empty record for a DRep that never voted", () => {
    const { votes, statistics } = summarizeDRepVotes([]);
    expect(votes.size).toBe(0);
    expect(statistics).toEqual({ total: 0, yes: 0, no: 0, abstain: 0 });
  });
});

describe("fetchDRepVoteRows", () => {
  it("follows pages until a short page and asks for them oldest first", async () => {
    const get = jest
      .fn<(path: string) => Promise<unknown>>()
      .mockResolvedValueOnce(page(100))
      .mockResolvedValueOnce(page(3, 100));

    const rows = await fetchDRepVoteRows(get, "drep1abc");

    expect(rows).toHaveLength(103);
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      "/governance/dreps/drep1abc/votes?count=100&page=1&order=asc",
      "/governance/dreps/drep1abc/votes?count=100&page=2&order=asc",
    ]);
  });

  it("stops on an empty or non-array page", async () => {
    const empty = jest.fn<(path: string) => Promise<unknown>>().mockResolvedValueOnce([]);
    expect(await fetchDRepVoteRows(empty, "drep1abc")).toEqual([]);

    const junk = jest
      .fn<(path: string) => Promise<unknown>>()
      .mockResolvedValueOnce(page(100))
      .mockResolvedValueOnce({ error: "nope" });
    expect(await fetchDRepVoteRows(junk, "drep1abc")).toHaveLength(100);
    expect(junk).toHaveBeenCalledTimes(2);
  });

  it("gives up after a bounded number of full pages", async () => {
    // A provider that always returns a full page must not loop forever.
    const get = jest.fn<(path: string) => Promise<unknown>>().mockResolvedValue(page(100));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const rows = await fetchDRepVoteRows(get, "drep1abc");
    expect(get).toHaveBeenCalledTimes(50);
    expect(rows).toHaveLength(5000);
    // Truncation drops the newest votes, so it must not be silent.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("abandons a fetch whose DRep is no longer on screen, without requesting more pages", async () => {
    // Switching between the wallet's DRep and a proxy DRep used to race two
    // paginated fetches; the one that finished last overwrote the record.
    let current = true;
    const get = jest.fn<(path: string) => Promise<unknown>>().mockImplementation(async () => {
      current = false; // the user switched DRep while page 1 was in flight
      return page(100);
    });

    const rows = await fetchDRepVoteRows(get, "drep1abc", () => current);

    expect(rows).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("discards a result that went stale on its last page", async () => {
    let current = true;
    const get = jest.fn<(path: string) => Promise<unknown>>().mockImplementation(async () => {
      current = false;
      return page(2);
    });
    expect(await fetchDRepVoteRows(get, "drep1abc", () => current)).toBeNull();
  });

  it("does not call the provider at all when already stale", async () => {
    const get = jest.fn<(path: string) => Promise<unknown>>();
    expect(await fetchDRepVoteRows(get, "drep1abc", () => false)).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
