import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * The governance router's proposal tallies. Both procedures are public, and
 * refreshProposalTally turns its input into a Blockfrost request made with the
 * server key plus a ProposalTally upsert — so the input shape is the only
 * thing standing between an anonymous caller and both of those.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyAsyncMock = jest.Mock<(...args: any[]) => any>;

const providerGet = jest.fn() as AnyAsyncMock;
const getProvider = jest.fn(() => ({ get: providerGet }));
const tallyFindMany = jest.fn() as AnyAsyncMock;
const tallyFindUnique = jest.fn() as AnyAsyncMock;
const tallyUpsert = jest.fn() as AnyAsyncMock;

// ESM-mode mocking: the router pulls superjson (ESM-only), so this suite is
// registered in ESM_TESTS and mocks with unstable_mockModule.
jest.unstable_mockModule("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider,
}));

const TX = "a".repeat(64);
const ID = `${TX}#0`;

function ctx() {
  return {
    ip: "203.0.113.7",
    sessionWallets: [],
    db: {
      proposalTally: {
        findMany: tallyFindMany,
        findUnique: tallyFindUnique,
        upsert: tallyUpsert,
      },
    },
  };
}

let caller: any;

beforeEach(async () => {
  jest.clearAllMocks();
  tallyFindMany.mockResolvedValue([]);
  tallyFindUnique.mockResolvedValue(null);
  tallyUpsert.mockImplementation(async ({ create }: any) => ({
    ...create,
    updatedAt: new Date(),
  }));
  const { governanceRouter } = await import("@/server/api/routers/governance");
  caller = (governanceRouter as any).createCaller(ctx());
});

describe("refreshProposalTally", () => {
  it("counts the latest vote per voter for a well-formed proposal id", async () => {
    providerGet.mockResolvedValueOnce([
      { voter: "drep1a", vote: "yes" },
      { voter: "drep1b", vote: "no" },
      { voter: "drep1a", vote: "abstain" },
    ]);

    const out = await caller.refreshProposalTally({ network: 0, proposalId: ID });

    expect(providerGet).toHaveBeenCalledWith(
      `/governance/proposals/${TX}/0/votes?count=100&page=1&order=asc`,
    );
    expect(out).toMatchObject({ proposalId: ID, yes: 0, no: 1, abstain: 1, total: 2 });
  });

  it.each([
    ["a path-traversal tx hash", "x/../../../health?#0"],
    ["a tx hash that is not 64 hex chars", `${"a".repeat(63)}#0`],
    ["a non-hex tx hash", `${"g".repeat(64)}#0`],
    ["a missing cert index", TX],
    ["a non-numeric cert index", `${TX}#x`],
    ["an absurd cert index", `${TX}#123456`],
    // Aliases of a real id: Blockfrost resolves them to the same proposal, so
    // accepting them would let one proposal fan out into many cached rows.
    ["an upper-case tx hash", `${"A".repeat(64)}#0`],
    ["a mixed-case tx hash", `${"aB".repeat(32)}#0`],
    ["a cert index with leading zeros", `${TX}#00`],
    ["a padded non-zero cert index", `${TX}#007`],
    ["an extra segment", `${ID}#1`],
    ["a very long string", `${TX}#0${"a".repeat(10_000)}`],
  ])("rejects %s without calling Blockfrost or writing a row", async (_label, proposalId) => {
    await expect(
      caller.refreshProposalTally({ network: 0, proposalId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(getProvider).not.toHaveBeenCalled();
    expect(tallyFindUnique).not.toHaveBeenCalled();
    expect(tallyUpsert).not.toHaveBeenCalled();
  });

  it.each([2, -1, 0.5])("rejects network %p", async (network) => {
    await expect(
      caller.refreshProposalTally({ network, proposalId: ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(tallyUpsert).not.toHaveBeenCalled();
  });

  it("still serves a fresh cached row without calling Blockfrost", async () => {
    tallyFindUnique.mockResolvedValueOnce({
      proposalId: ID, yes: 3, no: 0, abstain: 0, total: 3, capped: false,
      updatedAt: new Date(),
    });

    const out = await caller.refreshProposalTally({ network: 1, proposalId: ID });

    expect(out).toMatchObject({ yes: 3, total: 3 });
    expect(providerGet).not.toHaveBeenCalled();
  });
});

describe("getProposalTallies", () => {
  it("reads the cached rows for well-formed ids", async () => {
    await caller.getProposalTallies({ network: 1, proposalIds: [ID, `${TX}#12`] });

    expect(tallyFindMany).toHaveBeenCalledWith({
      where: { network: 1, proposalId: { in: [ID, `${TX}#12`] } },
    });
  });

  it("accepts as many ids as the proposals list can realistically hold", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `${TX}#${i}`);
    await expect(
      caller.getProposalTallies({ network: 0, proposalIds: ids }),
    ).resolves.toEqual([]);
  });

  it("rejects an unbounded id list", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `${TX}#${i % 1000}`);
    await expect(
      caller.getProposalTallies({ network: 0, proposalIds: ids }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(tallyFindMany).not.toHaveBeenCalled();
  });

  it("rejects a list containing a malformed id", async () => {
    await expect(
      caller.getProposalTallies({ network: 0, proposalIds: [ID, "not-an-id"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(tallyFindMany).not.toHaveBeenCalled();
  });
});
