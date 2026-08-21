import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";

const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, options?: unknown) => boolean>();

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/governance/txGovernance"));
});

const VOTE_TX = "ab".repeat(32);
const CERT_TX = "cd".repeat(32);
const PLAIN_TX = "ee".repeat(32);
const PROPOSAL_TX = "12".repeat(32);
const DREP_ID = "drep1yvh7vvcr5hz2j87uhpwsw3f7p69szxufg0gsmyc5lx9umnq0lqsla";

/**
 * fetch mock that routes by URL substring; handlers receive the parsed
 * request body (tx_info is a POST). Unmatched URLs 404.
 */
function mockKoios(
  routes: Record<string, unknown[] | ((body: any) => unknown)>,
) {
  global.fetch = jest.fn(async (input: unknown, init?: unknown) => {
    const url = String(input);
    for (const [needle, result] of Object.entries(routes)) {
      if (url.includes(needle)) {
        const requestBody = (init as { body?: string } | undefined)?.body;
        const body =
          typeof result === "function"
            ? result(requestBody ? JSON.parse(requestBody) : undefined)
            : result;
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as never;
}

function govRequest(body: Record<string, unknown> = {}): NextApiRequest {
  return {
    method: "POST",
    body: { network: "0", txHashes: [VOTE_TX, CERT_TX, PLAIN_TX], ...body },
  } as unknown as NextApiRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
});

describe("txGovernance API", () => {
  it("rejects non-POST requests", async () => {
    const res = createMockResponse();
    await handler({ method: "GET", body: {} } as unknown as NextApiRequest, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("rejects malformed, non-array, and oversized txHashes", async () => {
    for (const txHashes of [
      "not-an-array",
      [VOTE_TX, "nothex"],
      [VOTE_TX.slice(0, 60)],
      Array.from({ length: 501 }, () => VOTE_TX),
      [42],
    ]) {
      const res = createMockResponse();
      await handler(govRequest({ txHashes }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  it("rejects an unknown network", async () => {
    const res = createMockResponse();
    await handler(govRequest({ network: "9" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("stops when rate limited", async () => {
    applyRateLimitMock.mockReturnValue(false);
    global.fetch = jest.fn() as never;
    const res = createMockResponse();
    await handler(govRequest(), res);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns empty items for an empty hash list without calling Koios", async () => {
    global.fetch = jest.fn() as never;
    const res = createMockResponse();
    await handler(govRequest({ txHashes: [] }), res);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as jest.Mock).mock.calls[0]?.[0]).toEqual({ items: [] });
  });

  it("keeps governance certs, drops stake/pool certs, normalizes votes, joins titles", async () => {
    mockKoios({
      "/tx_info": [
        {
          tx_hash: VOTE_TX.toUpperCase(), // response keys must lowercase
          certificates: [],
          voting_procedures: [
            {
              vote: "yes",
              voter: DREP_ID,
              voter_role: "DRep",
              proposal_index: 3,
              proposal_tx_hash: PROPOSAL_TX,
            },
          ],
        },
        {
          tx_hash: CERT_TX,
          certificates: [
            { index: 0, type: "stake_registration", info: {} },
            { index: 1, type: "drep_registration", info: { drep_id: DREP_ID, deposit: "500000000" } },
          ],
          voting_procedures: [],
        },
        { tx_hash: PLAIN_TX, certificates: [], voting_procedures: [] },
      ],
      "/proposal_list": [
        {
          proposal_id: "gov_action1aaa",
          proposal_type: "InfoAction",
          title: "Hard Fork to Protocol Version 11",
          proposal_tx_hash: PROPOSAL_TX,
          proposal_index: 3,
        },
      ],
    });
    const res = createMockResponse();

    await handler(govRequest(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0]?.[0] as {
      items: Array<Record<string, any>>;
    };
    // PLAIN_TX has no governance content — omitted.
    expect(body.items).toHaveLength(2);
    const voteItem = body.items.find((item) => item.txHash === VOTE_TX)!;
    expect(voteItem.certs).toEqual([]);
    expect(voteItem.votes).toEqual([
      {
        voterRole: "DRep",
        voteKind: "Yes",
        proposalTxHash: PROPOSAL_TX,
        proposalIndex: 3,
        proposalTitle: "Hard Fork to Protocol Version 11",
      },
    ]);
    const certItem = body.items.find((item) => item.txHash === CERT_TX)!;
    // stake_registration filtered out; only the drep cert survives.
    expect(certItem.certs).toEqual([
      { type: "drep_registration", drepId: DREP_ID },
    ]);
  });

  it("dedupes input hashes and chunks tx_info calls at 50 (Koios ~5KB POST cap)", async () => {
    const manyHashes = Array.from({ length: 120 }, (_, i) =>
      i.toString(16).padStart(64, "0"),
    );
    const bodies: string[][] = [];
    mockKoios({
      "/tx_info": (body: any) => {
        bodies.push(body._tx_hashes);
        return [];
      },
      "/proposal_list": [],
    });
    const res = createMockResponse();

    await handler(
      govRequest({ txHashes: [...manyHashes, manyHashes[0]!.toUpperCase()] }),
      res,
    );

    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toHaveLength(50);
    expect(bodies[1]).toHaveLength(50);
    expect(bodies[2]).toHaveLength(20); // duplicate deduped, not 21
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("targets preprod Koios for network 0 and passes the governance flags", async () => {
    let captured: any;
    mockKoios({
      "/tx_info": (body: any) => {
        captured = body;
        return [];
      },
    });
    const res = createMockResponse();

    await handler(govRequest({ txHashes: [VOTE_TX] }), res);

    expect(String((global.fetch as jest.Mock).mock.calls[0]?.[0])).toContain(
      "https://preprod.koios.rest/api/v1/tx_info",
    );
    expect(captured).toMatchObject({ _certs: true, _governance: true, _inputs: false });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("still returns items when the title join fails", async () => {
    global.fetch = jest.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/tx_info")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              tx_hash: VOTE_TX,
              certificates: [],
              voting_procedures: [
                {
                  vote: "no",
                  voter: DREP_ID,
                  voter_role: "DRep",
                  proposal_index: 0,
                  proposal_tx_hash: PROPOSAL_TX,
                },
              ],
            },
          ],
        };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    }) as never;
    const res = createMockResponse();

    await handler(govRequest({ txHashes: [VOTE_TX] }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0]?.[0] as {
      items: Array<Record<string, any>>;
    };
    expect(body.items[0]!.votes[0]).toMatchObject({
      voteKind: "No",
      proposalTitle: null,
    });
  });

  it("returns 502 when Koios is unreachable", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as never;
    const res = createMockResponse();

    await handler(govRequest(), res);

    expect(res.status).toHaveBeenCalledWith(502);
  });
});
