import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * POST /api/github/create-issue — the "Create a ticket" dialog.
 *
 * Every accepted request becomes a public issue on MeshJS/multisig written with
 * the project's token, so the endpoint must not be a free issue-spam relay: it
 * takes POST only, from a caller with a wallet session, a handful per IP per
 * window, and only the two labels the dialog offers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const requestMock = jest.fn() as jest.Mock<(...args: any[]) => any>;
const sessionMock = jest.fn() as jest.Mock<(...args: any[]) => any>;
const envMock: { GITHUB_TOKEN: string | undefined } = { GITHUB_TOKEN: "ghp_test" };

jest.mock("@/env", () => ({ __esModule: true, env: envMock }));

jest.mock("@octokit/core", () => ({
  __esModule: true,
  Octokit: jest.fn().mockImplementation(() => ({ request: requestMock })),
}));

jest.mock("@/lib/auth/walletSession", () => ({
  __esModule: true,
  getWalletSessionFromReq: sessionMock,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: handler, parseIssueReport, MAX_TITLE_LENGTH, MAX_BODY_LENGTH } =
  require("@/pages/api/github/create-issue") as typeof import("@/pages/api/github/create-issue");

type Captured = NextApiResponse & { _status: number; _json: any; _headers: Record<string, string> };

function createResponse(): Captured {
  const state = { _status: 200, _json: undefined as unknown, _headers: {} as Record<string, string> };
  const res: Record<string, unknown> = {
    get _status() { return state._status; },
    get _json() { return state._json; },
    get _headers() { return state._headers; },
    setHeader(name: string, value: string) { state._headers[name] = value; return res; },
    status(code: number) { state._status = code; return res; },
    json(payload: unknown) { state._json = payload; return res; },
    end() { return res; },
  };
  return res as unknown as Captured;
}

// Each test gets its own IP so the real, process-global rate limiter starts fresh.
let ipCounter = 0;
function createRequest(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
  ipCounter += 1;
  const ip = `10.0.0.${ipCounter}`;
  return {
    method: "POST",
    headers: { "x-real-ip": ip },
    socket: { remoteAddress: ip },
    cookies: {},
    body: { title: "Send button does nothing", body: "Clicking send on a draft has no effect.", type: "bug" },
    ...overrides,
  } as unknown as NextApiRequest;
}

const SIGNED_IN = { wallets: ["addr_test1qpsigner"], primaryWallet: "addr_test1qpsigner" };

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ status: 201 });
  sessionMock.mockReset();
  sessionMock.mockReturnValue(SIGNED_IN);
  envMock.GITHUB_TOKEN = "ghp_test";
});

describe("parseIssueReport", () => {
  it("accepts a bug or enhancement report and trims it", () => {
    expect(parseIssueReport({ title: "  Title  ", body: " Body\n", type: "enhancement" })).toEqual({
      ok: true,
      report: { title: "Title", body: "Body", type: "enhancement" },
    });
  });

  it.each([
    ["no body at all", undefined],
    ["a missing title", { body: "b", type: "bug" }],
    ["a whitespace-only title", { title: "   ", body: "b", type: "bug" }],
    ["a missing body", { title: "t", type: "bug" }],
    ["a non-string body", { title: "t", body: { evil: true }, type: "bug" }],
    ["a label the dialog never offers", { title: "t", body: "b", type: "security" }],
    ["an array of labels", { title: "t", body: "b", type: ["bug", "wontfix"] }],
    ["an over-long title", { title: "x".repeat(MAX_TITLE_LENGTH + 1), body: "b", type: "bug" }],
    ["an over-long body", { title: "t", body: "x".repeat(MAX_BODY_LENGTH + 1), type: "bug" }],
  ])("rejects %s", (_label, input) => {
    expect(parseIssueReport(input).ok).toBe(false);
  });
});

describe("POST /api/github/create-issue", () => {
  it("files the report on MeshJS/multisig with the chosen label", async () => {
    const res = createResponse();
    await handler(createRequest(), res);

    expect(res._status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const [route, params] = requestMock.mock.calls[0]!;
    expect(route).toBe("POST /repos/{owner}/{repo}/issues");
    expect(params).toMatchObject({
      owner: "MeshJS",
      repo: "multisig",
      title: "Send button does nothing",
      body: "Clicking send on a draft has no effect.\n\nSubmitted via web form.",
      labels: ["bug"],
    });
  });

  it("only accepts POST", async () => {
    const res = createResponse();
    await handler(createRequest({ method: "GET" }), res);
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe("POST");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("refuses callers without a wallet session", async () => {
    sessionMock.mockReturnValue(null);
    const res = createResponse();
    await handler(createRequest(), res);
    expect(res._status).toBe(401);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("refuses a session that holds no wallets", async () => {
    sessionMock.mockReturnValue({ wallets: [] });
    const res = createResponse();
    await handler(createRequest(), res);
    expect(res._status).toBe(401);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("answers 400, not 500, for a malformed report", async () => {
    const res = createResponse();
    await handler(createRequest({ body: { title: "t", body: "b", type: "invalid" } }), res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/type/);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("answers 413 for an oversized request before parsing it", async () => {
    const res = createResponse();
    await handler(createRequest({ body: { title: "t", body: "x".repeat(20 * 1024), type: "bug" } }), res);
    expect(res._status).toBe(413);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("stops a single IP after five reports in the window", async () => {
    const req = createRequest();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = createResponse();
      await handler(req, res);
      statuses.push(res._status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(requestMock).toHaveBeenCalledTimes(5);
  });

  it("does not count rejected requests against the limit", async () => {
    const req = createRequest();
    const invalid = { ...req, body: { title: "", body: "b", type: "bug" } } as NextApiRequest;
    for (let i = 0; i < 6; i++) {
      const res = createResponse();
      await handler(invalid, res);
      expect(res._status).toBe(400);
    }
    sessionMock.mockReturnValue(null);
    for (let i = 0; i < 6; i++) {
      const res = createResponse();
      await handler(req, res);
      expect(res._status).toBe(401);
    }
    sessionMock.mockReturnValue(SIGNED_IN);
    const res = createResponse();
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  it("sends GitHub the trimmed title and body", async () => {
    const res = createResponse();
    await handler(createRequest({ body: { title: "  Padded  ", body: "\n text \n", type: "enhancement" } }), res);
    expect(res._status).toBe(200);
    expect(requestMock.mock.calls[0]![1]).toMatchObject({
      title: "Padded",
      body: "text\n\nSubmitted via web form.",
      labels: ["enhancement"],
    });
  });

  it("says 503 when no GitHub token is configured", async () => {
    envMock.GITHUB_TOKEN = undefined;
    const res = createResponse();
    await handler(createRequest(), res);
    expect(res._status).toBe(503);
  });

  it("answers 502 without leaking GitHub's error when issue creation fails", async () => {
    requestMock.mockRejectedValue(new Error("Resource not accessible by personal access token"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = createResponse();
    await handler(createRequest(), res);
    spy.mockRestore();
    expect(res._status).toBe(502);
    expect(JSON.stringify(res._json)).not.toMatch(/personal access token/);
  });
});
