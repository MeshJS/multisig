import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * POST /api/oauth/decision — where consent becomes a grant.
 *
 * The interesting property is the scope ceiling. The consent screen lets the
 * user hand over less than the client asked for, and it posts that selection in
 * the request body — which is attacker-controlled. The signed handle minted by
 * /api/oauth/authorize is the only authority on what was actually requested, so
 * the body must be able to narrow the grant and never to widen it.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyAsyncMock = jest.Mock<(...args: any[]) => any>;

const applyRateLimitMock = jest.fn<() => boolean>();
const enforceBodySizeMock = jest.fn<() => boolean>();
const sessionMock = jest.fn() as jest.Mock<(...args: any[]) => any>;
const codeCreateMock = jest.fn() as AnyAsyncMock;
const grantUpsertMock = jest.fn() as AnyAsyncMock;

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}));

jest.mock("@/lib/auth/walletSession", () => ({
  __esModule: true,
  getWalletSessionFromReq: sessionMock,
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        oAuthAuthorizationCode: { create: codeCreateMock },
        oAuthGrant: { upsert: grantUpsertMock },
      }),
  },
}));

const ISSUER = "https://multisig.example";
const ADDR = "addr1qpuser";
const REDIRECT = "https://app.example/cb";

type Captured = NextApiResponse & { _status: number; _json: any };

function createResponse(): Captured {
  const state = { _status: 200, _json: undefined as unknown };
  const res: Record<string, unknown> = {
    get _status() { return state._status; },
    get _json() { return state._json; },
    setHeader() { return res; },
    status(code: number) { state._status = code; return res; },
    json(payload: unknown) { state._json = payload; return res; },
    end() { return res; },
  };
  return res as unknown as Captured;
}

let decision: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;
let encode: typeof import("@/lib/oauth/requests").encodeAuthorizationRequest;

beforeAll(async () => {
  process.env.JWT_SECRET ??= "test-secret-that-is-at-least-32-chars-long";
  process.env.OAUTH_ISSUER_URL = ISSUER;
  ({ default: decision } = await import("../pages/api/oauth/decision"));
  ({ encodeAuthorizationRequest: encode } = await import("@/lib/oauth/requests"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  sessionMock.mockReturnValue({ wallets: [ADDR], primaryWallet: ADDR });
  codeCreateMock.mockResolvedValue({});
  grantUpsertMock.mockResolvedValue({});
});

/** A signed handle for a request asking for all three scopes. */
function handleFor(scopes: string[]) {
  return encode({
    clientId: "mcp-client",
    clientName: "Test Client",
    redirectUri: REDIRECT,
    scopes: scopes as never,
    resource: `${ISSUER}/api/mcp`,
    codeChallenge: "challenge",
    state: "xyz",
  } as never);
}

function post(body: Record<string, unknown>) {
  return {
    method: "POST",
    headers: { host: "multisig.example" },
    body,
  } as unknown as NextApiRequest;
}

/** The scopes actually written to the durable grant row. */
function grantedScopes() {
  return (grantUpsertMock.mock.calls[0]?.[0] as any)?.create?.scopes;
}

const ALL = ["wallets:read", "governance:read", "ballots:write"];

describe("scope selection", () => {
  it("grants everything requested when the body names no subset", async () => {
    const res = createResponse();
    await decision(post({ request: handleFor(ALL), approved: true }), res);

    expect(res._status).toBe(200);
    expect(grantedScopes()).toEqual(ALL);
  });

  it("narrows the grant to the boxes the user left ticked", async () => {
    const res = createResponse();
    await decision(
      post({
        request: handleFor(ALL),
        approved: true,
        scopes: ["wallets:read", "governance:read"],
      }),
      res,
    );

    expect(res._status).toBe(200);
    expect(grantedScopes()).toEqual(["wallets:read", "governance:read"]);
  });

  it("cannot be widened past the signed request, whatever the body claims", async () => {
    // The body is attacker-controlled; the handle is not. Asking for more than
    // the client requested must yield the intersection, not the union.
    const res = createResponse();
    await decision(
      post({
        request: handleFor(["wallets:read"]),
        approved: true,
        scopes: ALL,
      }),
      res,
    );

    expect(res._status).toBe(200);
    expect(grantedScopes()).toEqual(["wallets:read"]);
  });

  it("writes the same scopes to the authorization code as to the grant", async () => {
    // The code is what the token endpoint mints from. If the two disagreed, the
    // issued token would not match what the user saw themselves approve.
    const res = createResponse();
    await decision(
      post({ request: handleFor(ALL), approved: true, scopes: ["wallets:read"] }),
      res,
    );

    expect(res._status).toBe(200);
    expect((codeCreateMock.mock.calls[0]?.[0] as any).data.scopes).toEqual([
      "wallets:read",
    ]);
    expect(grantedScopes()).toEqual(["wallets:read"]);
  });

  it("refuses an approval that grants nothing", async () => {
    // A zero-scope grant authenticates but exposes no tools, which reads to the
    // client as a broken server rather than a refusal.
    const res = createResponse();
    await decision(
      post({ request: handleFor(ALL), approved: true, scopes: [] }),
      res,
    );

    expect(res._status).toBe(400);
    expect(res._json.error).toBe("invalid_scope");
    expect(grantUpsertMock).not.toHaveBeenCalled();
  });

  it("ignores non-string entries rather than trusting them", async () => {
    const res = createResponse();
    await decision(
      post({
        request: handleFor(ALL),
        approved: true,
        scopes: ["wallets:read", 42, null, { toString: () => "ballots:write" }],
      }),
      res,
    );

    expect(res._status).toBe(200);
    expect(grantedScopes()).toEqual(["wallets:read"]);
  });
});

describe("consent still requires a wallet session", () => {
  it("refuses to record a grant with no session, however the body is shaped", async () => {
    sessionMock.mockReturnValue(null);
    const res = createResponse();
    await decision(
      post({ request: handleFor(ALL), approved: true, scopes: ALL }),
      res,
    );

    expect(res._status).toBe(401);
    expect(grantUpsertMock).not.toHaveBeenCalled();
  });

  it("denies without touching the grant when the user cancels", async () => {
    const res = createResponse();
    await decision(
      post({ request: handleFor(ALL), approved: false, scopes: ALL }),
      res,
    );

    expect(res._status).toBe(200);
    expect(String(res._json.redirectTo)).toContain("error=access_denied");
    expect(grantUpsertMock).not.toHaveBeenCalled();
  });
});
