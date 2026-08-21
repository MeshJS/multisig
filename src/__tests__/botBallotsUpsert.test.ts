import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

const addCorsCacheBustingHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string) => boolean>();
const enforceBodySizeMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, maxBytes: number) => boolean>();
const verifyJwtMock = jest.fn<() => unknown>();
const isBotJwtMock = jest.fn<() => boolean>();
const applyAddressRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, address: string) => boolean>();
const assertBotWalletAccessMock = jest.fn<() => Promise<unknown>>();
const assertWalletAccessMock = jest.fn<() => Promise<unknown>>();
const findBotUserMock = jest.fn<() => Promise<unknown>>();
const transactionMock = jest.fn<(cb: (tx: typeof txMock) => Promise<unknown>) => Promise<unknown>>();
const parseScopeMock = jest.fn<(scope: string) => string[]>();
const scopeIncludesMock = jest.fn<(scopes: string[], required: string) => boolean>();
const isValidChoiceMock = jest.fn();
const parseProposalIdMock = jest.fn<
  (value: string) => { txHash: string; certIndex: number }
>();

const txMock = {
  ballot: {
    findUnique: jest.fn<() => Promise<unknown>>(),
    findMany: jest.fn<() => Promise<unknown[]>>(),
    create: jest.fn<() => Promise<unknown>>(),
    updateMany: jest.fn<() => Promise<unknown>>(),
  },
};

jest.unstable_mockModule(
  "@/lib/cors",
  () => ({
    __esModule: true,
    addCorsCacheBustingHeaders: addCorsCacheBustingHeadersMock,
    cors: corsMock,
  }),
);

jest.unstable_mockModule(
  "@/lib/security/requestGuards",
  () => ({
    __esModule: true,
    applyRateLimit: applyRateLimitMock,
    applyBotRateLimit: applyBotRateLimitMock,
    applyAddressRateLimit: applyAddressRateLimitMock,
    enforceBodySize: enforceBodySizeMock,
  }),
);

jest.unstable_mockModule(
  "@/lib/security/rateLimit",
  () => ({
    __esModule: true,
    getClientIP: () => "127.0.0.1",
  }),
);

jest.unstable_mockModule(
  "@/server/api/auth",
  () => ({
    __esModule: true,
    assertWalletAccess: assertWalletAccessMock,
  }),
);

jest.unstable_mockModule(
  "@/lib/verifyJwt",
  () => ({
    __esModule: true,
    verifyJwt: verifyJwtMock,
    isBotJwt: isBotJwtMock,
  }),
);

jest.unstable_mockModule(
  "@/lib/governance",
  () => ({
    __esModule: true,
    isValidChoice: isValidChoiceMock,
    parseProposalId: parseProposalIdMock,
  }),
);

jest.unstable_mockModule(
  "@/lib/auth/botKey",
  () => ({
    __esModule: true,
    parseScope: parseScopeMock,
    scopeIncludes: scopeIncludesMock,
  }),
);

jest.unstable_mockModule(
  "@/lib/auth/botAccess",
  () => ({
  BotAccessError: class extends Error { constructor(public status: number, message: string) { super(message); } },
    __esModule: true,
    assertBotWalletAccess: assertBotWalletAccessMock,
  }),
);

jest.unstable_mockModule(
  "@/server/db",
  () => ({
    __esModule: true,
    db: {
      botUser: {
        findUnique: findBotUserMock,
      },
      $transaction: transactionMock,
    },
  }),
);

type ResponseMock = NextApiResponse & { statusCode?: number };

function createMockResponse(): ResponseMock {
  const res = {
    statusCode: undefined as number | undefined,
    status: jest.fn<(code: number) => NextApiResponse>(),
    json: jest.fn<(payload: unknown) => unknown>(),
    end: jest.fn<() => void>(),
    setHeader: jest.fn<(name: string, value: string) => void>(),
  };

  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res as unknown as NextApiResponse;
  });
  res.json.mockImplementation((payload: unknown) => payload);
  return res as unknown as ResponseMock;
}

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/botBallotsUpsert"));
});

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200 })) as never;
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  applyAddressRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue({ address: "addr_test1", botId: "bot-1", type: "bot" });
  isBotJwtMock.mockReturnValue(true);
  parseScopeMock.mockImplementation((scope) => JSON.parse(scope) as string[]);
  scopeIncludesMock.mockImplementation((scopes, required) =>
    scopes.includes(required),
  );
  isValidChoiceMock.mockReturnValue(true);
  parseProposalIdMock.mockImplementation((value) => {
    const [txHash, certIndex] = value.split("#");
    return { txHash: txHash ?? "", certIndex: Number(certIndex) };
  });
  findBotUserMock.mockResolvedValue({
    id: "bot-1",
    botKey: { scope: JSON.stringify(["multisig:read", "ballot:write"]) },
  });
  // Observer role suffices for ballot drafting (unsigned advisory rows).
  assertBotWalletAccessMock.mockResolvedValue({ wallet: { id: "wallet-1", signersAddresses: ["addr_test1qexample"] }, role: "observer" });
  transactionMock.mockImplementation(async (cb: any) => cb(txMock));
});

describe("botBallotsUpsert API", () => {
  it("requests non-mutating wallet access (observer role is enough to draft)", async () => {
    const req = {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: {
        walletId: "wallet-1",
        ballotName: "Advisory",
        proposals: [{ proposalId: "a".repeat(64) + "#0", proposalTitle: "T", choice: "Yes" }],
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    // The access assertion must be called with mutating=false — cosigner must
    // NOT be required for advisory drafts.
    expect(assertBotWalletAccessMock as jest.Mock).toHaveBeenCalledWith(
      expect.anything(),
      "wallet-1",
      expect.anything(),
      false,
    );
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it("rejects anchor fields in proposal payload", async () => {
    const req = {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: {
        walletId: "wallet-1",
        proposals: [
          {
            proposalId: "b".repeat(64) + "#0",
            proposalTitle: "Title",
            choice: "Yes",
            anchorUrl: "ipfs://should-not-be-allowed",
          },
        ],
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 409 when ballotName is ambiguous", async () => {
    txMock.ballot.findMany.mockResolvedValue([
      { id: "b1", walletId: "wallet-1", type: 1, description: "Gov", updatedAt: new Date() },
      { id: "b2", walletId: "wallet-1", type: 1, description: "Gov", updatedAt: new Date() },
    ]);

    const req = {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: {
        walletId: "wallet-1",
        ballotName: "Gov",
        proposals: [{ proposalId: "b".repeat(64) + "#0", proposalTitle: "Title", choice: "No" }],
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: "Multiple ballots match ballotName; provide ballotId to disambiguate",
    });
  });

  it("rejects a proposalId whose txHash is not 64-hex", async () => {
    const req = {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: {
        walletId: "wallet-1",
        ballotName: "Advisory",
        proposals: [{ proposalId: "deadbeef#0", proposalTitle: "T", choice: "Yes" }],
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects proposalIds that do not exist on-chain, listing them", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404 })) as never;
    const req = {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: {
        walletId: "wallet-1",
        ballotName: "Advisory",
        proposals: [{ proposalId: "c".repeat(64) + "#0", proposalTitle: "T", choice: "Yes" }],
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as unknown as jest.Mock).mock.calls[0]?.[0] as any;
    expect(body.proposalIds).toEqual(["c".repeat(64) + "#0"]);
  });

  it("fails open when the chain indexer is unavailable", async () => {
    global.fetch = jest.fn(async () => { throw new Error("indexer down"); }) as never;
    const fresh = {
      id: "b-new", walletId: "wallet-1", type: 1, description: "Advisory", updatedAt: new Date(),
      items: [], itemDescriptions: [], choices: [], anchorUrls: [], anchorHashes: [], rationaleComments: [],
    };
    txMock.ballot.findMany.mockResolvedValue([]);
    txMock.ballot.create.mockResolvedValue(fresh);
    txMock.ballot.updateMany.mockResolvedValue({ count: 1 } as never);
    txMock.ballot.findUnique.mockResolvedValue(fresh);
    const req = {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: {
        walletId: "wallet-1",
        ballotName: "Advisory",
        proposals: [{ proposalId: "d".repeat(64) + "#0", proposalTitle: "T", choice: "Yes" }],
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  describe("human (non-bot) callers", () => {
    const asHuman = () => {
      verifyJwtMock.mockReturnValue({ address: "addr_test1qphuman" });
      isBotJwtMock.mockReturnValue(false);
      assertWalletAccessMock.mockResolvedValue({ id: "wallet-1" });
    };

    const humanRequest = () =>
      ({
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: {
          walletId: "wallet-1",
          ballotName: "Gov",
          proposals: [{ proposalId: "tx#0", proposalTitle: "Title", choice: "Yes" }],
        },
      }) as unknown as NextApiRequest;

    it("authorizes a human via the shared signer-or-owner check", async () => {
      asHuman();
      txMock.ballot.findMany.mockResolvedValue([]);
      const res = createMockResponse();

      await handler(humanRequest(), res);

      // The canonical predicate from @/server/api/auth, not a local copy, and
      // not the bot-only path.
      expect(assertWalletAccessMock).toHaveBeenCalled();
      expect(assertBotWalletAccessMock).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it("returns 403 when the human is neither signer nor owner", async () => {
      asHuman();
      assertWalletAccessMock.mockRejectedValue(
        Object.assign(new Error("Not authorized for this wallet"), {
          code: "FORBIDDEN",
        }),
      );
      const res = createMockResponse();

      await handler(humanRequest(), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it("maps an unknown wallet to 404 rather than 403", async () => {
      asHuman();
      assertWalletAccessMock.mockRejectedValue(
        Object.assign(new Error("Wallet not found"), { code: "NOT_FOUND" }),
      );
      const res = createMockResponse();

      await handler(humanRequest(), res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("does not require the ballot:write bot scope of a human", async () => {
      asHuman();
      // A human has no bot key at all; the scope lookup must never run for them.
      txMock.ballot.findMany.mockResolvedValue([]);
      const res = createMockResponse();

      await handler(humanRequest(), res);

      expect(findBotUserMock).not.toHaveBeenCalled();
      expect(scopeIncludesMock).not.toHaveBeenCalled();
    });

    it("still requires cosigner access for bot callers", async () => {
      // Regression guard: the human branch must not weaken the bot branch.
      assertBotWalletAccessMock.mockRejectedValue(
        new Error("Bot observer cannot perform this action"),
      );
      const res = createMockResponse();

      await handler(humanRequest(), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(assertWalletAccessMock).not.toHaveBeenCalled();
    });
  });
});
