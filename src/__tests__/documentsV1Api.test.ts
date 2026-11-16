import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { TRPCError } from "@trpc/server";
import type { NextApiRequest, NextApiResponse } from "next";

import { createMockResponse, makeBearerAuth } from "./apiTestUtils";

/**
 * GET /api/v1/documents and /api/v1/documentDetail — the handlers behind the
 * `document_list` / `document_get` MCP tools.
 *
 * Neither handler authorizes on its own: both delegate to the document router
 * (`listByWallet`, `getById`), which refuses with a TRPCError. Those refusals
 * are answers to the caller — "not a signer", "no such document" — and must
 * reach it with their HTTP meaning. Only a genuine fault is a 500, because a
 * model reading a 500 concludes "try again", not "this user cannot see that".
 */

const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const verifyJwtMock: jest.Mock = jest.fn();
const isBotJwtMock: jest.Mock = jest.fn();
const listByWalletMock: jest.Mock = jest.fn();
const getByIdMock: jest.Mock = jest.fn();
const createCallerMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: jest.fn(),
  cors: corsMock,
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: () => true,
  applyBotRateLimit: () => true,
}));

jest.mock("@/lib/security/rateLimit", () => ({
  __esModule: true,
  getClientIP: () => "127.0.0.1",
}));

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: verifyJwtMock,
  isBotJwt: isBotJwtMock,
}));

jest.mock("@/server/db", () => ({ __esModule: true, db: {} }));

jest.mock("@/server/api/root", () => ({
  __esModule: true,
  createCaller: createCallerMock,
}));

const HUMAN_ADDRESS = "addr_test1qphumanfixture0000000000000000000000000000000000";

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;
let listHandler: Handler;
let detailHandler: Handler;

beforeAll(async () => {
  ({ default: listHandler } = await import("../pages/api/v1/documents"));
  ({ default: detailHandler } = await import("../pages/api/v1/documentDetail"));
});

beforeEach(() => {
  jest.clearAllMocks();
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue({ address: HUMAN_ADDRESS });
  isBotJwtMock.mockReturnValue(false);
  createCallerMock.mockReturnValue({
    document: { listByWallet: listByWalletMock, getById: getByIdMock },
  });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

function request(query: Record<string, string>): NextApiRequest {
  return {
    method: "GET",
    headers: makeBearerAuth("human-token"),
    query: { address: HUMAN_ADDRESS, ...query },
  } as unknown as NextApiRequest;
}

const routes = [
  {
    name: "documents (list)",
    call: (res: NextApiResponse) => listHandler(request({ walletId: "wallet-1" }), res),
    procedure: () => listByWalletMock,
  },
  {
    name: "documentDetail (get)",
    call: (res: NextApiResponse) => detailHandler(request({ documentId: "doc-1" }), res),
    procedure: () => getByIdMock,
  },
];

describe.each(routes)("v1 $name — router refusals keep their HTTP meaning", ({ call, procedure }) => {
  it.each([
    ["FORBIDDEN", 403, "Not authorized for this wallet"],
    ["NOT_FOUND", 404, "Document not found"],
    ["UNAUTHORIZED", 401, "UNAUTHORIZED"],
  ] as const)("%s from the router is a %i with the router's message", async (code, status, message) => {
    (procedure() as any).mockRejectedValue(new TRPCError({ code, message }));
    const res = createMockResponse();
    await call(res);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ error: message, code });
  });

  it("a zod input failure is a 400 naming the field, not the raw issue list", async () => {
    const issues = JSON.stringify([{ path: ["walletId"], message: "String must contain at least 1 character(s)" }]);
    (procedure() as any).mockRejectedValue(new TRPCError({ code: "BAD_REQUEST", message: issues }));
    const res = createMockResponse();
    await call(res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "walletId: String must contain at least 1 character(s)",
      code: "BAD_REQUEST",
    });
  });

  it("a non-tRPC failure is still a 500 that leaks nothing", async () => {
    (procedure() as any).mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    const res = createMockResponse();
    await call(res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
    expect(console.error).toHaveBeenCalled();
  });

  // What a real caller produces for a database fault: tRPC wraps the Prisma
  // error as INTERNAL_SERVER_ERROR and keeps its message.
  it("a wrapped server fault stays a logged, generic 500 — its message never reaches the caller", async () => {
    const leaky = "Invalid prisma.document.findMany() invocation: connect ECONNREFUSED 10.0.0.5:5432";
    (procedure() as any).mockRejectedValue(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: leaky }));
    const res = createMockResponse();
    await call(res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("v1 documents — the happy path is unchanged", () => {
  it("lists the wallet's documents as projections", async () => {
    (listByWalletMock as any).mockResolvedValue([
      { id: "doc-1", walletId: "wallet-1", title: "Charter", status: "Draft", versions: [] },
    ]);
    const res = createMockResponse();
    await listHandler(request({ walletId: "wallet-1" }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(listByWalletMock).toHaveBeenCalledWith({ walletId: "wallet-1", includeArchived: false });
    const body = (res.json as jest.Mock).mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(body[0]).toMatchObject({ documentId: "doc-1", walletId: "wallet-1", title: "Charter" });
  });

  it("documentDetail answers 404 when the router returns no row", async () => {
    (getByIdMock as any).mockResolvedValue(null);
    const res = createMockResponse();
    await detailHandler(request({ documentId: "doc-1" }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("bot keys are refused before the router is reached", async () => {
    isBotJwtMock.mockReturnValue(true);
    verifyJwtMock.mockReturnValue({ address: HUMAN_ADDRESS, botId: "bot-1" });
    const res = createMockResponse();
    await listHandler(request({ walletId: "wallet-1" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(createCallerMock).not.toHaveBeenCalled();
  });
});
