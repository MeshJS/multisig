import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";

const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, options?: unknown) => boolean>();

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/governance/drepVotes"));
});

const DREP_ID = "drep1ygqgayvx8yzsaj9hprja3l6jy3v4px9z3u8uvecuvm3f92ce7mckx";

const koiosVote = (overrides: Record<string, unknown> = {}) => ({
  proposal_id: "gov_action1aaa",
  proposal_tx_hash: "aa".repeat(32),
  proposal_index: 0,
  vote_tx_hash: "bb".repeat(32),
  block_time: 1_784_521_956,
  vote: "No",
  meta_url: "ipfs://bafyexample",
  meta_hash: "cc".repeat(32),
  ...overrides,
});

/** fetch mock that routes by URL substring; unmatched URLs 404. */
function mockKoios(routes: Record<string, unknown[] | (() => unknown)>) {
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(input);
    for (const [needle, result] of Object.entries(routes)) {
      if (url.includes(needle)) {
        const body = typeof result === "function" ? result() : result;
        return {
          ok: true,
          status: 200,
          json: async () => body,
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as never;
}

function votesRequest(query: Record<string, unknown> = {}): NextApiRequest {
  return {
    method: "GET",
    query: { drepId: DREP_ID, network: "1", ...query },
  } as unknown as NextApiRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
});

describe("drepVotes API", () => {
  it("rejects non-GET requests", async () => {
    const res = createMockResponse();
    await handler({ method: "POST", query: {} } as unknown as NextApiRequest, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("rejects a malformed drepId", async () => {
    const res = createMockResponse();
    await handler(votesRequest({ drepId: "not-a-drep;rm -rf" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects an unknown network", async () => {
    const res = createMockResponse();
    await handler(votesRequest({ network: "9" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("stops when rate limited", async () => {
    applyRateLimitMock.mockReturnValue(false);
    global.fetch = jest.fn() as never;
    const res = createMockResponse();
    await handler(votesRequest(), res);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("joins votes with proposal titles and normalizes types", async () => {
    mockKoios({
      "/drep_votes": [
        koiosVote({ block_time: 100, vote: "yes" }),
        koiosVote({
          proposal_id: "gov_action1bbb",
          block_time: 200,
          vote: "Abstain",
          meta_url: null,
          meta_hash: null,
        }),
      ],
      "/proposal_list": [
        {
          proposal_id: "gov_action1aaa",
          proposal_type: "TreasuryWithdrawals",
          title: "Fund the treasury thing",
        },
      ],
    });
    const res = createMockResponse();

    await handler(votesRequest(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0]?.[0] as {
      drepId: string;
      votes: Array<Record<string, unknown>>;
    };
    expect(body.drepId).toBe(DREP_ID);
    expect(body.votes).toHaveLength(2);
    // Sorted newest first regardless of upstream order.
    expect(body.votes[0]).toMatchObject({
      proposalId: "gov_action1bbb",
      vote: "Abstain",
      metaUrl: null,
      proposalTitle: null,
      proposalType: null,
    });
    expect(body.votes[1]).toMatchObject({
      proposalId: "gov_action1aaa",
      vote: "Yes",
      metaUrl: "ipfs://bafyexample",
      proposalTitle: "Fund the treasury thing",
      proposalType: "treasury_withdrawals",
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      expect.stringContaining("s-maxage"),
    );
  });

  it("targets preprod Koios for network 0", async () => {
    mockKoios({ "/drep_votes": [] });
    const res = createMockResponse();

    await handler(votesRequest({ network: "0" }), res);

    expect(String((global.fetch as jest.Mock).mock.calls[0]?.[0])).toContain(
      "https://preprod.koios.rest/api/v1/drep_votes",
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("paginates when a page comes back full", async () => {
    const fullPage = Array.from({ length: 500 }, (_, i) =>
      koiosVote({ proposal_id: `gov_action1page${i}`, block_time: i }),
    );
    let votesCall = 0;
    mockKoios({
      "/drep_votes": () => (votesCall++ === 0 ? fullPage : [koiosVote()]),
      "/proposal_list": [],
    });
    const res = createMockResponse();

    await handler(votesRequest(), res);

    const voteUrls = (global.fetch as jest.Mock).mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/drep_votes"));
    expect(voteUrls).toHaveLength(2);
    expect(voteUrls[1]).toContain("offset=500");
    const body = (res.json as jest.Mock).mock.calls[0]?.[0] as {
      votes: unknown[];
    };
    expect(body.votes).toHaveLength(501);
  });

  it("still returns votes when the title join fails", async () => {
    global.fetch = jest.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/drep_votes")) {
        return { ok: true, status: 200, json: async () => [koiosVote()] };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    }) as never;
    const res = createMockResponse();

    await handler(votesRequest(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0]?.[0] as {
      votes: Array<Record<string, unknown>>;
    };
    expect(body.votes).toHaveLength(1);
    expect(body.votes[0]).toMatchObject({ proposalTitle: null, proposalType: null });
  });

  it("returns 502 when Koios is unreachable", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as never;
    const res = createMockResponse();

    await handler(votesRequest(), res);

    expect(res.status).toHaveBeenCalledWith(502);
  });
});
