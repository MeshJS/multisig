import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse, type ResponseMock } from "./apiTestUtils";

/**
 * Linking a Discord account to a wallet address (start → discord.com →
 * callback). These specs pin down two things:
 *
 *  - the OAuth state is its own token family: it is not a v1 bearer token,
 *    and nothing else signed with JWT_SECRET passes as a state;
 *  - only the wallet session that started the flow can finish it, so a
 *    victim cannot be made to link their Discord to someone else's wallet.
 */

const SECRET = "s".repeat(32);
const ALICE = "addr_test1qpdiscordlinkalice0000000000000000000000000000000";
const MALLORY = "addr_test1qpdiscordlinkmallory00000000000000000000000000000";

const userUpdateMany = jest.fn<(args: unknown) => Promise<{ count: number }>>();
jest.mock("@/server/db", () => ({
  __esModule: true,
  db: { user: { updateMany: userUpdateMany } },
}));

const auditMock = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("@/lib/observability/audit", () => ({
  __esModule: true,
  audit: auditMock,
}));

jest.mock("@/lib/security/rateLimit", () => ({
  __esModule: true,
  getClientIP: () => "203.0.113.7",
}));

jest.mock("@/env", () => ({
  __esModule: true,
  env: { NODE_ENV: "test", JWT_SECRET: "s".repeat(32) },
}));

const getWalletSessionFromReq = jest.fn<(req: NextApiRequest) => unknown>();
jest.mock("@/lib/auth/walletSession", () => ({
  __esModule: true,
  getWalletSessionFromReq,
}));

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;
let start: Handler;
let callback: Handler;
let lib: typeof import("@/lib/auth/discordLinkState");
let verifyJwt: typeof import("@/lib/verifyJwt").verifyJwt;

const fetchMock = jest.fn<typeof fetch>();
const realFetch = global.fetch;

type RedirectingResponse = ResponseMock & { redirect: jest.Mock };
function response(): RedirectingResponse {
  const res = createMockResponse() as unknown as Omit<RedirectingResponse, "redirect"> & {
    redirect?: jest.Mock;
  };
  res.redirect = jest.fn();
  return res as unknown as RedirectingResponse;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Discord answers the token exchange, /users/@me and the guild check. */
function discordAnswers(discordId = "424242") {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) return json({ access_token: "discord-at" });
    if (url.endsWith("/users/@me")) return json({ id: discordId });
    if (url.includes("/guilds/")) return json({}, 200);
    throw new Error(`unexpected fetch ${url}`);
  });
}

/** A started flow: the state, and the nonce cookie start set in the browser. */
type Flow = { state: string; nonce: string };

/** `cookieNonce`: the browser's nonce cookie — the flow's own by default, null for none. */
const callbackRequest = (
  flow: Flow | string,
  cookieNonce: string | null = typeof flow === "string" ? null : flow.nonce,
): NextApiRequest =>
  ({
    method: "GET",
    query: { code: "discord-code", state: typeof flow === "string" ? flow : flow.state },
    headers: {},
    cookies: cookieNonce === null ? {} : { discord_link_nonce: cookieNonce },
  }) as unknown as NextApiRequest;

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID = "client-id";
  global.fetch = fetchMock as unknown as typeof fetch;
  lib = await import("@/lib/auth/discordLinkState");
  ({ verifyJwt } = await import("@/lib/verifyJwt"));
  ({ default: start } = await import("../pages/api/auth/discord/start"));
  ({ default: callback } = await import("../pages/api/auth/discord/callback"));
});

afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  getWalletSessionFromReq.mockReturnValue(null);
  userUpdateMany.mockResolvedValue({ count: 1 });
  auditMock.mockResolvedValue(undefined);
});

describe("the Discord link state token", () => {
  it("round-trips the address it was minted for", () => {
    const { state, nonce } = lib.mintDiscordLinkState(ALICE);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(lib.verifyDiscordLinkState(state)).toEqual({ address: ALICE, nonce });
  });

  it("is not accepted as a v1 bearer token", () => {
    // The state travels in URLs to discord.com and back; it must not be an
    // API credential for the address it names.
    expect(verifyJwt(lib.mintDiscordLinkState(ALICE).state)).toBeNull();
  });

  it("rejects a v1 bearer token posing as a state", () => {
    const bearer = jwt.sign({ address: ALICE }, SECRET, { expiresIn: "1h" });
    expect(lib.verifyDiscordLinkState(bearer)).toBeNull();
  });

  it("rejects the legacy { address, nonce } state shape", () => {
    const legacy = jwt.sign({ address: ALICE, nonce: "ab" }, SECRET, { expiresIn: "10m" });
    expect(lib.verifyDiscordLinkState(legacy)).toBeNull();
  });

  it("rejects a state signed with another secret, or expired", () => {
    const claims = { typ: lib.DISCORD_LINK_STATE_TYPE, sub: ALICE, nonce: "ab" };
    expect(
      lib.verifyDiscordLinkState(jwt.sign(claims, "o".repeat(32), { expiresIn: "10m" })),
    ).toBeNull();
    const expired = jwt.sign(
      { ...claims, exp: Math.floor(Date.now() / 1000) - 1 },
      SECRET,
    );
    expect(lib.verifyDiscordLinkState(expired)).toBeNull();
  });

  it("rejects garbage instead of throwing", () => {
    expect(lib.verifyDiscordLinkState("not-a-jwt")).toBeNull();
  });
});

describe("GET /api/auth/discord/start", () => {
  it("answers 401 without a wallet session", async () => {
    const res = response();
    await start({ method: "GET", cookies: {} } as unknown as NextApiRequest, res);
    expect(res.statusCode).toBe(401);
  });

  it("returns an authorize URL whose state names the session's primary wallet, and sets its nonce cookie", async () => {
    getWalletSessionFromReq.mockReturnValue({ wallets: [MALLORY, ALICE], primaryWallet: ALICE });
    const res = response();
    await start({ method: "GET", cookies: {} } as unknown as NextApiRequest, res);

    expect(res.statusCode).toBe(200);
    const { url } = (res.json as jest.Mock).mock.calls[0]![0] as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    const verified = lib.verifyDiscordLinkState(state);
    expect(verified?.address).toBe(ALICE);
    expect(verifyJwt(state)).toBeNull();
    const cookie = (res.setHeader as jest.Mock).mock.calls.find(([name]) => name === "Set-Cookie")?.[1];
    expect(cookie).toContain(`discord_link_nonce=${verified!.nonce};`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/auth/discord");
  });
});

describe("GET /api/auth/discord/callback", () => {
  it("answers 400 for a state that is not a Discord link state", async () => {
    const res = response();
    const bearer = jwt.sign({ address: ALICE, nonce: "ab" }, SECRET, { expiresIn: "10m" });
    await callback(callbackRequest(bearer), res);
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("answers 400 when the browser does not hold the state's nonce cookie", async () => {
    // A leaked state opened anywhere but the browser that started the flow —
    // e.g. paired with someone else's Discord code.
    getWalletSessionFromReq.mockReturnValue({ wallets: [ALICE], primaryWallet: ALICE });
    const flow = lib.mintDiscordLinkState(ALICE);
    for (const cookie of [null, lib.mintDiscordLinkState(ALICE).nonce]) {
      const res = response();
      await callback(callbackRequest(flow, cookie), res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("clears the nonce cookie on every callback, so a state finishes at most once", async () => {
    getWalletSessionFromReq.mockReturnValue({ wallets: [ALICE], primaryWallet: ALICE });
    const res = response();
    await callback(callbackRequest(lib.mintDiscordLinkState(MALLORY)), res);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.stringMatching(/^discord_link_nonce=;.*Max-Age=0/),
    );
  });

  it("refuses to finish a flow in a browser with no wallet session", async () => {
    // Mallory started the flow and sent the authorize link to a victim who is
    // not signed in here.
    const res = response();
    await callback(callbackRequest(lib.mintDiscordLinkState(MALLORY)), res);

    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "auth.discord.session_mismatch", outcome: "denied" }),
    );
  });

  it("refuses to finish a flow started by a different wallet's session", async () => {
    // The victim is signed in — as themselves, not as Mallory.
    getWalletSessionFromReq.mockReturnValue({ wallets: [ALICE], primaryWallet: ALICE });
    const res = response();
    await callback(callbackRequest(lib.mintDiscordLinkState(MALLORY)), res);

    expect(res.statusCode).toBe(403);
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("links the Discord account when the starting session finishes the flow", async () => {
    getWalletSessionFromReq.mockReturnValue({ wallets: [ALICE], primaryWallet: ALICE });
    discordAnswers("424242");
    const res = response();
    await callback(callbackRequest(lib.mintDiscordLinkState(ALICE)), res);

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { address: ALICE },
      data: { discordId: "424242" },
    });
    expect(res.redirect).toHaveBeenCalledWith("/");
  });

  it("accepts any wallet of the session, not only the primary one", async () => {
    getWalletSessionFromReq.mockReturnValue({ wallets: [MALLORY, ALICE], primaryWallet: MALLORY });
    discordAnswers();
    const res = response();
    await callback(callbackRequest(lib.mintDiscordLinkState(ALICE)), res);

    expect(userUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { address: ALICE } }),
    );
  });

  it("answers 404, not 500, when the wallet has no user record", async () => {
    getWalletSessionFromReq.mockReturnValue({ wallets: [ALICE], primaryWallet: ALICE });
    discordAnswers();
    userUpdateMany.mockResolvedValue({ count: 0 });
    const res = response();
    await callback(callbackRequest(lib.mintDiscordLinkState(ALICE)), res);

    expect(res.statusCode).toBe(404);
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
