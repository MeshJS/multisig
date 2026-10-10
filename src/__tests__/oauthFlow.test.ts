import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createHash, randomBytes } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * The authorization and token endpoints, focused on the paths where a mistake
 * is a vulnerability rather than a bug: open redirection, code replay, PKCE
 * bypass, and refresh-token reuse.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyAsyncMock = jest.Mock<(...args: any[]) => any>;

const resolveClientMock = jest.fn() as AnyAsyncMock;
const applyRateLimitMock = jest.fn<() => boolean>();
const applyStrictRateLimitMock = jest.fn<() => boolean>();
const enforceBodySizeMock = jest.fn<() => boolean>();

const codeFindUniqueMock = jest.fn() as AnyAsyncMock;
const codeUpdateManyMock = jest.fn() as AnyAsyncMock;
const refreshUpdateManyMock = jest.fn() as AnyAsyncMock;
const issueRefreshTokenMock = jest.fn() as AnyAsyncMock;
const redeemRefreshTokenMock = jest.fn() as AnyAsyncMock;
const markRotatedMock = jest.fn() as AnyAsyncMock;

// Mocked wholesale rather than via requireActual: the real module imports
// @/server/db, which eagerly builds a Prisma client and pg pool at import time
// (see the note in jest.config.mjs). Pulling that into the test process leaves
// open handles and made this suite flaky. The pure URL helpers it re-exports
// live in @/lib/oauth/redirects and are unit-tested there directly.
jest.mock("@/lib/oauth/clients", () => ({
  __esModule: true,
  resolveClient: resolveClientMock,
  hashSecret: (secret: string) =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require("crypto") as typeof import("crypto"))
      .createHash("sha256")
      .update(secret)
      .digest("hex"),
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  applyStrictRateLimit: applyStrictRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}));

// Only the database-backed refresh store is mocked. The pure access-token
// crypto in @/lib/oauth/accessToken runs for real, and nothing in this suite
// imports @/server/db — which builds a Prisma client at import time and made
// this test intermittently reach for a real database.
jest.mock("@/lib/oauth/tokens", () => ({
  __esModule: true,
  issueRefreshToken: issueRefreshTokenMock,
  redeemRefreshToken: redeemRefreshTokenMock,
  markRefreshTokenRotated: markRotatedMock,
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    oAuthAuthorizationCode: {
      findUnique: codeFindUniqueMock,
      updateMany: codeUpdateManyMock,
    },
    oAuthRefreshToken: { updateMany: refreshUpdateManyMock },
  },
}));

const ISSUER = "https://multisig.example";
const CLIENT = {
  id: "row-1",
  clientId: "mcp-client",
  clientName: "Test Client",
  clientUri: null,
  redirectUris: ["http://127.0.0.1/callback", "https://app.example/cb"],
  tokenEndpointAuthMethod: "none",
  secretHash: null,
  isMetadataUrl: false,
  createdAt: new Date(),
  lastSeenAt: new Date(),
};

const VERIFIER = randomBytes(32).toString("base64url");
const CHALLENGE = createHash("sha256").update(VERIFIER, "ascii").digest("base64url");

type Captured = NextApiResponse & {
  _status: number;
  _json: unknown;
  _redirect: string | null;
  _headers: Record<string, string>;
};

function createResponse(): Captured {
  const state = {
    _status: 200,
    _json: undefined as unknown,
    _redirect: null as string | null,
    _headers: {} as Record<string, string>,
  };
  const res: Record<string, unknown> = {
    get _status() { return state._status; },
    get _json() { return state._json; },
    get _redirect() { return state._redirect; },
    get _headers() { return state._headers; },
    setHeader(name: string, value: string) {
      state._headers[name.toLowerCase()] = String(value);
      return res;
    },
    status(code: number) { state._status = code; return res; },
    json(payload: unknown) { state._json = payload; return res; },
    end() { return res; },
    redirect(code: number, url: string) {
      state._status = code;
      state._redirect = url;
      return res;
    },
  };
  return res as unknown as Captured;
}

let authorize: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;
let token: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

beforeAll(async () => {
  process.env.JWT_SECRET ??= "test-secret-that-is-at-least-32-chars-long";
  process.env.OAUTH_ISSUER_URL = ISSUER;
  ({ default: authorize } = await import("../pages/api/oauth/authorize"));
  ({ default: token } = await import("../pages/api/oauth/token"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  applyStrictRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  resolveClientMock.mockResolvedValue(CLIENT);
  issueRefreshTokenMock.mockResolvedValue("new-refresh-token");
  markRotatedMock.mockResolvedValue(undefined);
  // The atomic claim in redeemRefreshToken succeeds by default; a test that
  // wants to simulate losing the race overrides this to { count: 0 }.
  refreshUpdateManyMock.mockResolvedValue({ count: 1 });
  codeUpdateManyMock.mockResolvedValue({ count: 1 });
});

function authorizeRequest(query: Record<string, string>) {
  return {
    method: "GET",
    headers: { host: "multisig.example" },
    query: {
      response_type: "code",
      client_id: "mcp-client",
      redirect_uri: "https://app.example/cb",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      scope: "wallets:read",
      state: "xyz",
      ...query,
    },
  } as unknown as NextApiRequest;
}

describe("GET /api/oauth/authorize", () => {
  it("redirects a valid request to the consent screen", async () => {
    const res = createResponse();
    await authorize(authorizeRequest({}), res);

    expect(res._status).toBe(302);
    expect(res._redirect).toMatch(/^\/oauth\/consent\?request=/);
  });

  it("refuses to redirect to an unregistered redirect_uri", async () => {
    // The critical one. Redirecting an unvalidated redirect_uri would make this
    // an open redirector and leak authorization codes to the attacker.
    const res = createResponse();
    await authorize(
      authorizeRequest({ redirect_uri: "https://evil.example/steal" }),
      res,
    );

    expect(res._status).toBe(400);
    expect(res._redirect).toBeNull();
    expect(res._json).toMatchObject({ error: "invalid_request" });
  });

  it("refuses an unknown client without redirecting", async () => {
    resolveClientMock.mockResolvedValue(null);
    const res = createResponse();
    await authorize(authorizeRequest({}), res);

    expect(res._status).toBe(400);
    expect(res._redirect).toBeNull();
    expect(res._json).toMatchObject({ error: "invalid_client" });
  });

  it("rejects code_challenge_method=plain via the client redirect", async () => {
    const res = createResponse();
    await authorize(
      authorizeRequest({ code_challenge_method: "plain" }),
      res,
    );

    expect(res._status).toBe(302);
    const url = new URL(res._redirect as string);
    expect(url.origin + url.pathname).toBe("https://app.example/cb");
    expect(url.searchParams.get("error")).toBe("invalid_request");
    // RFC 9207 — the client must be able to tell which AS answered.
    expect(url.searchParams.get("iss")).toBe(ISSUER);
    expect(url.searchParams.get("state")).toBe("xyz");
  });

  it("rejects a resource that is not this server (RFC 8707)", async () => {
    const res = createResponse();
    await authorize(
      authorizeRequest({ resource: "https://other.example/api/mcp" }),
      res,
    );

    const url = new URL(res._redirect as string);
    expect(url.searchParams.get("error")).toBe("invalid_target");
  });

  it("defaults to read-only scope when the client requests none", async () => {
    const res = createResponse();
    const req = authorizeRequest({});
    delete (req.query as Record<string, unknown>).scope;
    await authorize(req, res);

    const handle = new URL(res._redirect as string, ISSUER).searchParams.get("request");
    const { decodeAuthorizationRequest } = await import("@/lib/oauth/requests");
    expect(decodeAuthorizationRequest(handle as string)?.scopes).toEqual([
      "wallets:read",
    ]);
  });

  it("drops unknown scopes rather than granting them", async () => {
    const res = createResponse();
    await authorize(
      authorizeRequest({ scope: "wallets:read admin:everything" }),
      res,
    );

    const handle = new URL(res._redirect as string, ISSUER).searchParams.get("request");
    const { decodeAuthorizationRequest } = await import("@/lib/oauth/requests");
    expect(decodeAuthorizationRequest(handle as string)?.scopes).toEqual([
      "wallets:read",
    ]);
  });
});

describe("POST /api/oauth/token — authorization_code", () => {
  const validCode = () => ({
    id: "code-1",
    codeHash: "hash",
    clientId: "mcp-client",
    subjectAddress: "addr_test1qpuser",
    grantedAddresses: ["addr_test1qpuser"],
    scopes: ["wallets:read"],
    resource: `${ISSUER}/api/mcp`,
    redirectUri: "https://app.example/cb",
    codeChallenge: CHALLENGE,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    createdAt: new Date(),
  });

  const tokenRequest = (body: Record<string, unknown>) =>
    ({
      method: "POST",
      headers: { host: "multisig.example" },
      query: {},
      body,
    }) as unknown as NextApiRequest;

  it("exchanges a valid code for an access token", async () => {
    codeFindUniqueMock.mockResolvedValue(validCode());
    const res = createResponse();
    await token(
      tokenRequest({
        grant_type: "authorization_code",
        client_id: "mcp-client",
        code: "the-code",
        code_verifier: VERIFIER,
      }),
      res,
    );

    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({
      token_type: "Bearer",
      scope: "wallets:read",
    });
  });

  it("rejects a wrong PKCE verifier", async () => {
    codeFindUniqueMock.mockResolvedValue(validCode());
    const res = createResponse();
    await token(
      tokenRequest({
        grant_type: "authorization_code",
        client_id: "mcp-client",
        code: "the-code",
        code_verifier: randomBytes(32).toString("base64url"),
      }),
      res,
    );

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "invalid_grant" });
  });

  it("revokes the grant when a consumed code is replayed", async () => {
    codeFindUniqueMock.mockResolvedValue({
      ...validCode(),
      consumedAt: new Date(),
    });
    const res = createResponse();
    await token(
      tokenRequest({
        grant_type: "authorization_code",
        client_id: "mcp-client",
        code: "the-code",
        code_verifier: VERIFIER,
      }),
      res,
    );

    expect(res._status).toBe(400);
    // Replay means the code leaked; every refresh token under that grant dies.
    expect(refreshUpdateManyMock).toHaveBeenCalled();
  });

  it("rejects a code belonging to a different client", async () => {
    codeFindUniqueMock.mockResolvedValue({
      ...validCode(),
      clientId: "someone-else",
    });
    const res = createResponse();
    await token(
      tokenRequest({
        grant_type: "authorization_code",
        client_id: "mcp-client",
        code: "the-code",
        code_verifier: VERIFIER,
      }),
      res,
    );

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "invalid_grant" });
  });

  it("rejects an expired code", async () => {
    codeFindUniqueMock.mockResolvedValue({
      ...validCode(),
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = createResponse();
    await token(
      tokenRequest({
        grant_type: "authorization_code",
        client_id: "mcp-client",
        code: "the-code",
        code_verifier: VERIFIER,
      }),
      res,
    );

    expect(res._status).toBe(400);
  });

  it("loses a race for the same code exactly once", async () => {
    codeFindUniqueMock.mockResolvedValue(validCode());
    // Simulates the other request having consumed the row first.
    codeUpdateManyMock.mockResolvedValue({ count: 0 });
    const res = createResponse();
    await token(
      tokenRequest({
        grant_type: "authorization_code",
        client_id: "mcp-client",
        code: "the-code",
        code_verifier: VERIFIER,
      }),
      res,
    );

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "invalid_grant" });
  });
});

describe("POST /api/oauth/token — refresh_token", () => {
  const tokenRequest = (body: Record<string, unknown>) =>
    ({
      method: "POST",
      headers: { host: "multisig.example" },
      query: {},
      body,
    }) as unknown as NextApiRequest;

  const liveToken = () => ({
    id: "rt-1",
    tokenHash: "hash",
    clientId: "mcp-client",
    subjectAddress: "addr_test1qpuser",
    grantedAddresses: ["addr_test1qpuser"],
    scopes: ["wallets:read", "ballots:write"],
    resource: `${ISSUER}/api/mcp`,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    replacedById: null,
    createdAt: new Date(),
  });

  it("rotates the refresh token on use", async () => {
    redeemRefreshTokenMock.mockResolvedValue({ ok: true, record: liveToken() });
    const res = createResponse();
    await token(
      tokenRequest({
        grant_type: "refresh_token",
        client_id: "mcp-client",
        refresh_token: "old-token",
      }),
      res,
    );

    expect(res._status).toBe(200);
    expect(issueRefreshTokenMock).toHaveBeenCalled();
    expect(markRotatedMock).toHaveBeenCalled();
  });

  it("revokes the chain when a rotated token is replayed", async () => {
    redeemRefreshTokenMock.mockResolvedValue({ ok: false, reason: "replayed" });
    const res = createResponse();
    await token(
      tokenRequest({
        grant_type: "refresh_token",
        client_id: "mcp-client",
        refresh_token: "old-token",
      }),
      res,
    );

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "invalid_grant" });
    expect(issueRefreshTokenMock).not.toHaveBeenCalled();
  });

  it("treats losing the atomic claim race as a replay", async () => {
    // Two concurrent redemptions of the same token: the loser must not also
    // mint. Without the conditional update both would pass the in-memory
    // replacedById check and rotation would stop detecting replay at all.
    redeemRefreshTokenMock.mockResolvedValue({ ok: false, reason: "replayed" });
    const res = createResponse();
    await token(
      tokenRequest({
        grant_type: "refresh_token",
        client_id: "mcp-client",
        refresh_token: "old-token",
      }),
      res,
    );

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "invalid_grant" });
    expect(issueRefreshTokenMock).not.toHaveBeenCalled();
  });

  it("refuses a zero-scope refresh instead of minting a useless token", async () => {
    // An empty scope set yields a token that verifies but registers no tools,
    // so every MCP call answers "method not found" with no way to diagnose it.
    redeemRefreshTokenMock.mockResolvedValue({ ok: true, record: liveToken() });
    const res = createResponse();
    await token(
      tokenRequest({
        grant_type: "refresh_token",
        client_id: "mcp-client",
        refresh_token: "old-token",
        scope: "openid",
      }),
      res,
    );

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "invalid_scope" });
  });

  it("refuses a refresh token presented by another client", async () => {
    redeemRefreshTokenMock.mockResolvedValue({ ok: false, reason: "unknown" });
    const res = createResponse();
    await token(
      tokenRequest({
        grant_type: "refresh_token",
        client_id: "mcp-client",
        refresh_token: "old-token",
      }),
      res,
    );

    expect(res._status).toBe(400);
  });

  it("allows narrowing scope but not widening it", async () => {
    redeemRefreshTokenMock.mockResolvedValue({ ok: true, record: liveToken() });
    const res = createResponse();
    await token(
      tokenRequest({
        grant_type: "refresh_token",
        client_id: "mcp-client",
        refresh_token: "old-token",
        scope: "wallets:read governance:read",
      }),
      res,
    );

    // governance:read was never granted, so it must not appear.
    expect(res._json).toMatchObject({ scope: "wallets:read" });
  });

  it("rejects an unsupported grant type", async () => {
    const res = createResponse();
    await token(
      tokenRequest({ grant_type: "password", client_id: "mcp-client" }),
      res,
    );

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "unsupported_grant_type" });
  });
});
