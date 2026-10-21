import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse, makeApiRequest } from "./apiTestUtils";

/**
 * The Discord endpoints act with the project bot's token. These specs pin
 * down who may make the bot speak, to whom, and which ids may reach a
 * Discord API URL at all.
 */

type Wallet = { id: string; name: string; signersAddresses: string[]; ownerAddress: string | null };
type User = { address: string; discordId: string };

// A tiny in-memory stand-in for the two Prisma queries the relay makes,
// honouring the same filters (`id`, `in`) Postgres would.
let wallets: Wallet[] = [];
let users: User[] = [];
const walletFindUnique = jest.fn(
  async (args: any) => wallets.find((w) => w.id === args.where.id) ?? null,
);
const userFindMany = jest.fn(async (args: any) =>
  users.filter(
    (u) =>
      args.where.address.in.includes(u.address) &&
      args.where.discordId.in.includes(u.discordId),
  ),
);

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    wallet: { findUnique: walletFindUnique },
    user: { findMany: userFindMany },
  },
}));

const getWalletSessionFromReq = jest.fn<(req: NextApiRequest) => unknown>();
jest.mock("@/lib/auth/walletSession", () => ({
  __esModule: true,
  getWalletSessionFromReq,
}));

jest.mock("@/lib/notifications/center", () => ({
  __esModule: true,
  getSiteUrl: () => "https://multisig.example",
}));

const rateLimitAllows = jest.fn((..._args: unknown[]) => true);
jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: rateLimitAllows,
  applyStrictRateLimit: rateLimitAllows,
  applyAddressRateLimit: rateLimitAllows,
  enforceBodySize: () => true,
}));

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;
let sendMessage: Handler;
let getUser: Handler;
let lib: typeof import("@/lib/discord/walletNotification");

beforeAll(async () => {
  ({ default: sendMessage } = await import("../pages/api/discord/send-message"));
  ({ default: getUser } = await import("../pages/api/discord/get-user"));
  lib = await import("@/lib/discord/walletNotification");
});

const WALLET_ID = "cmwalletid0001";
const OTHER_WALLET_ID = "cmwalletid0002";
const ME = "addr_test1_me";
const OWNER = "addr_test1_owner";
const COSIGNER = "addr_test1_cosigner";
const STRANGER = "addr_test1_stranger";
const COSIGNER_DISCORD = "123456789012345678";
const MY_DISCORD = "223456789012345678";
const STRANGER_DISCORD = "323456789012345678";

const fetchMock = jest.fn(async (url: unknown, _init?: unknown) => {
  const u = String(url);
  if (u.endsWith("/users/@me/channels")) {
    return { ok: true, status: 200, json: async () => ({ id: "dm-channel" }) };
  }
  if (u.includes("/channels/dm-channel/messages")) {
    return { ok: true, status: 200, json: async () => ({}) };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: COSIGNER_DISCORD,
      avatar: "abc",
      discriminator: "0",
      email: "leak@example.com",
    }),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  wallets = [
    { id: WALLET_ID, name: "Treasury", signersAddresses: [ME, COSIGNER], ownerAddress: OWNER },
    // Anyone can create a wallet listing public addresses as signers.
    { id: OTHER_WALLET_ID, name: "Bait", signersAddresses: [STRANGER], ownerAddress: null },
  ];
  users = [
    { address: ME, discordId: MY_DISCORD },
    { address: COSIGNER, discordId: COSIGNER_DISCORD },
    { address: STRANGER, discordId: STRANGER_DISCORD },
  ];
  getWalletSessionFromReq.mockReturnValue({ wallets: [ME] });
  global.fetch = fetchMock as unknown as typeof fetch;
});

const post = (body: unknown) =>
  makeApiRequest({ method: "POST", body, headers: {}, cookies: {} });

const dmsSent = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/messages")).length;

const notify = (overrides: Record<string, unknown> = {}) =>
  post({ walletId: WALLET_ID, kind: "transactionReminder", discordIds: [COSIGNER_DISCORD], ...overrides });

const sentContents = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/messages"))
    .map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body)).content as string);

describe("POST /api/discord/send-message", () => {
  it("DMs the wallet's signers a message the server wrote", async () => {
    const res = createMockResponse();
    await sendMessage(notify({ discordIds: [COSIGNER_DISCORD, MY_DISCORD] }), res);

    expect(res.statusCode).toBe(200);
    expect(sentContents()).toEqual([
      "**REMINDER:** Your signature is needed for a transaction in `Treasury`. Review it here: https://multisig.example/wallets/cmwalletid0001/transactions",
      "**REMINDER:** Your signature is needed for a transaction in `Treasury`. Review it here: https://multisig.example/wallets/cmwalletid0001/transactions",
    ]);
  });

  it("ignores caller-supplied text", async () => {
    const res = createMockResponse();
    await sendMessage(notify({ message: "Claim your airdrop at https://evil.example" }), res);

    expect(res.statusCode).toBe(200);
    expect(sentContents().join()).not.toContain("evil.example");
  });

  it("lets the wallet's owner notify its signers", async () => {
    getWalletSessionFromReq.mockReturnValue({ wallets: [OWNER] });
    const res = createMockResponse();
    await sendMessage(notify(), res);

    expect(res.statusCode).toBe(200);
    expect(dmsSent()).toBe(1);
  });

  it("accepts a session whose second address is the member", async () => {
    getWalletSessionFromReq.mockReturnValue({ wallets: [STRANGER, ME] });
    const res = createMockResponse();
    await sendMessage(notify(), res);

    expect(res.statusCode).toBe(200);
  });

  it("stops at the per-signer rate limit, before touching Discord", async () => {
    rateLimitAllows
      .mockImplementationOnce(() => true) // per IP
      .mockImplementationOnce(() => false); // per signer
    const res = createMockResponse();
    await sendMessage(notify(), res);

    expect(rateLimitAllows).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      `discordSend:${ME}`,
      10,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses callers without a wallet session, before touching Discord", async () => {
    getWalletSessionFromReq.mockReturnValue(null);
    const res = createMockResponse();
    await sendMessage(notify(), res);

    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a caller who is neither signer nor owner of the wallet", async () => {
    getWalletSessionFromReq.mockReturnValue({ wallets: [STRANGER] });
    const res = createMockResponse();
    await sendMessage(notify(), res);

    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown wallet", async () => {
    const res = createMockResponse();
    await sendMessage(notify({ walletId: "nope" }), res);

    expect(res.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the whole request when any recipient is not a signer of that wallet", async () => {
    // The stranger signs another wallet — that does not make them reachable from this one.
    const res = createMockResponse();
    await sendMessage(notify({ discordIds: [COSIGNER_DISCORD, STRANGER_DISCORD] }), res);

    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a Discord id that no signer holds", async () => {
    const res = createMockResponse();
    await sendMessage(notify({ discordIds: ["999999999999999999"] }), res);

    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["ids not an array", { discordIds: COSIGNER_DISCORD }],
    ["a non-snowflake id", { discordIds: ["@me"] }],
    ["too many ids", { discordIds: Array(51).fill(COSIGNER_DISCORD) }],
    ["an unknown kind", { kind: "freeText" }],
    ["no walletId", { walletId: undefined }],
    ["a walletId that is a path", { walletId: "../admin" }],
  ])("rejects %s with 400", async (_label, overrides) => {
    const res = createMockResponse();
    await sendMessage(notify(overrides), res);

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing body with 400", async () => {
    const res = createMockResponse();
    await sendMessage(post(undefined), res);
    expect(res.statusCode).toBe(400);
  });

  it("treats an empty recipient list as a successful no-op", async () => {
    const res = createMockResponse();
    await sendMessage(notify({ discordIds: [] }), res);

    expect(res.statusCode).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends one DM per distinct recipient", async () => {
    const res = createMockResponse();
    await sendMessage(notify({ discordIds: [COSIGNER_DISCORD, COSIGNER_DISCORD] }), res);

    expect(res.statusCode).toBe(200);
    expect(dmsSent()).toBe(1);
  });

  it("only accepts POST", async () => {
    const res = createMockResponse();
    await sendMessage(makeApiRequest({ method: "GET", headers: {} }), res);
    expect(res.statusCode).toBe(405);
  });
});

describe("buildDiscordNotification", () => {
  const wallet = { id: WALLET_ID, name: "Treasury" };
  const site = "https://multisig.example";

  it.each([
    ["newTransaction", "A new Multisig transaction has been created", "/transactions"],
    ["ccVote", "A new CC Vote was created", "/transactions"],
    ["transactionReminder", "signature is needed for a transaction", "/transactions"],
    ["datumReminder", "signature is needed for a Datum", "/signing"],
  ] as const)("%s links to the wallet's %s page", (kind, phrase, path) => {
    const text = lib.buildDiscordNotification(kind, wallet, site);
    expect(text).toContain(phrase);
    expect(text.endsWith(`${site}/wallets/${WALLET_ID}${path}`)).toBe(true);
  });

  it("puts the wallet name in inline code so it cannot carry links or markup", () => {
    // Breaking out of the code span would need a backtick; there are none left.
    expect(lib.formatWalletName("x` https://evil.example `@everyone\n**hi**")).toBe(
      "`x https://evil.example @everyone **hi**`",
    );
    expect(lib.formatWalletName("a`b\nc")).toBe("`a b c`");
    expect(lib.formatWalletName("```")).toBe("`Unnamed wallet`");
    expect(lib.formatWalletName("safe\u202Etxt.exe\u200B")).toBe("`safetxt.exe`");
    expect(lib.formatWalletName("n".repeat(500))).toHaveLength(102);
  });
});

describe("GET /api/discord/get-user", () => {
  const get = (discordId: unknown) =>
    makeApiRequest({ method: "GET", query: { discordId } as any, headers: {} });

  it("returns only the fields the avatar needs", async () => {
    const res = createMockResponse();
    await getUser(get(COSIGNER_DISCORD), res);

    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith({
      id: COSIGNER_DISCORD,
      avatar: "abc",
      discriminator: "0",
    });
  });

  it.each(["@me", "@me/guilds", "123/../../guilds/1", "", undefined, ["1", "2"]])(
    "rejects %p without calling Discord",
    async (discordId) => {
      const res = createMockResponse();
      await getUser(get(discordId), res);

      expect(res.statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("does not relay Discord's error body", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "401: Unauthorized (bot token details)",
    }) as any);
    const res = createMockResponse();
    await getUser(get(COSIGNER_DISCORD), res);

    expect(res.statusCode).toBe(502);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to fetch Discord user data" });
  });
});
