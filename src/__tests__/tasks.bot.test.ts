import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { TRPCError } from "@trpc/server";
import type { NextApiRequest, NextApiResponse } from "next";

import {
  BOT_TEST_ADDRESS,
  createMockResponse,
  makeBearerAuth,
  makeBotJwtPayload,
} from "./apiTestUtils";

/**
 * GET /api/v1/tasks — the handler behind the `task_list` MCP tool.
 *
 * The point of the handler is dual-identity authorization: a bot is admitted
 * by its WalletBotAccess grant (its payment address is not a signer, so the
 * router's session check cannot be what admits it), a human by the router's
 * signer-or-owner rule. Everything else is projection and filtering.
 */

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string) => boolean>();
const verifyJwtMock: jest.Mock = jest.fn();
const isBotJwtMock: jest.Mock = jest.fn();
const getBotWalletAccessMock: jest.Mock = jest.fn();
const listWalletTasksMock: jest.Mock = jest.fn();
const taskListMock: jest.Mock = jest.fn();
const createCallerMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  applyBotRateLimit: applyBotRateLimitMock,
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

jest.mock("@/lib/auth/botAccess", () => ({
  __esModule: true,
  getBotWalletAccess: getBotWalletAccessMock,
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {},
}));

jest.mock("@/server/api/root", () => ({
  __esModule: true,
  createCaller: createCallerMock,
}));

// The router module pulls tRPC and Prisma; the handler needs only the shared
// board query and the status vocabulary from it.
jest.mock("@/server/api/routers/tasks", () => ({
  __esModule: true,
  TASK_STATUSES: ["Backlog", "InProgress", "InReview", "Done"],
  listWalletTasks: listWalletTasksMock,
}));

const HUMAN_ADDRESS = "addr_test1qphumanfixture0000000000000000000000000000000000";

function task(over: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    walletId: "wallet-1",
    title: "Ship it",
    description: null,
    status: "Done",
    priority: null,
    assigneeAddress: null,
    dueDate: null,
    position: 0,
    createdBy: HUMAN_ADDRESS,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-02T00:00:00Z"),
    recipients: [{ address: "addr_test1qrecipient", unit: "lovelace", quantity: "5000000", label: null }],
    payouts: [],
    payout: { state: "ready", transactionId: null, txHash: null, payable: true, blocker: null },
    ...over,
  };
}

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/tasks"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue(makeBotJwtPayload());
  isBotJwtMock.mockReturnValue(true);
  (getBotWalletAccessMock as any).mockResolvedValue({ allowed: true, role: "observer" });
  (listWalletTasksMock as any).mockResolvedValue([task()]);
  (taskListMock as any).mockResolvedValue([task()]);
  createCallerMock.mockReturnValue({ task: { list: taskListMock } });
});

function botRequest(query: Record<string, string>): NextApiRequest {
  return {
    method: "GET",
    headers: makeBearerAuth(),
    query: { walletId: "wallet-1", address: BOT_TEST_ADDRESS, ...query },
  } as unknown as NextApiRequest;
}

describe("tasks v1 API — bot identity", () => {
  it("returns 403 when the bot has no grant on the wallet (and never reads the board)", async () => {
    (getBotWalletAccessMock as any).mockResolvedValue({ allowed: false, reason: "not_granted" });
    const res = createMockResponse();
    await handler(botRequest({}), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(listWalletTasksMock).not.toHaveBeenCalled();
    expect(createCallerMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown wallet", async () => {
    (getBotWalletAccessMock as any).mockResolvedValue({ allowed: false, reason: "wallet_not_found" });
    const res = createMockResponse();
    await handler(botRequest({}), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("admits a granted observer through the shared board query, not the tRPC session", async () => {
    const res = createMockResponse();
    await handler(botRequest({}), res);
    expect(getBotWalletAccessMock).toHaveBeenCalledWith(expect.anything(), "wallet-1", expect.any(String));
    expect(listWalletTasksMock).toHaveBeenCalledWith(expect.anything(), "wallet-1");
    // A bot's payment address is not a signer: the router's session check
    // would refuse it, so the handler must not go that way.
    expect(createCallerMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0]![0] as {
      tasks: { id: string; dueDate: null; createdAt: string; payout: { payable: boolean } }[];
      count: number;
      payableCount: number;
    };
    expect(body.count).toBe(1);
    expect(body.payableCount).toBe(1);
    expect(body.tasks[0]!.createdAt).toBe("2026-09-01T00:00:00.000Z");
    expect(body.tasks[0]!.payout.payable).toBe(true);
  });

  it("filters by status and payable while payableCount stays wallet-wide", async () => {
    (listWalletTasksMock as any).mockResolvedValue([
      task({ id: "done-payable" }),
      task({
        id: "done-blocked",
        payout: { state: "pending", transactionId: "tx-1", txHash: null, payable: false, blocker: "pending" },
      }),
      task({
        id: "backlog",
        status: "Backlog",
        payout: { state: "ready", transactionId: null, txHash: null, payable: false, blocker: "not_done" },
      }),
    ]);

    let res = createMockResponse();
    await handler(botRequest({ status: "Done" }), res);
    let body = (res.json as jest.Mock).mock.calls[0]![0] as { tasks: { id: string }[]; count: number; payableCount: number };
    expect(body.tasks.map((t) => t.id)).toEqual(["done-payable", "done-blocked"]);
    expect(body.payableCount).toBe(1);

    res = createMockResponse();
    await handler(botRequest({ payable: "true" }), res);
    body = (res.json as jest.Mock).mock.calls[0]![0] as typeof body;
    expect(body.tasks.map((t) => t.id)).toEqual(["done-payable"]);
    expect(body.count).toBe(1);
    expect(body.payableCount).toBe(1);
  });

  it("rejects a status outside the board's columns", async () => {
    const res = createMockResponse();
    await handler(botRequest({ status: "Archived" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(listWalletTasksMock).not.toHaveBeenCalled();
  });
});

describe("tasks v1 API — human identity", () => {
  beforeEach(() => {
    verifyJwtMock.mockReturnValue({ address: HUMAN_ADDRESS });
    isBotJwtMock.mockReturnValue(false);
  });

  it("refuses an address that does not match the token", async () => {
    const res = createMockResponse();
    await handler(
      { method: "GET", headers: makeBearerAuth(), query: { walletId: "wallet-1", address: "addr_test1qsomeoneelse" } } as unknown as NextApiRequest,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(createCallerMock).not.toHaveBeenCalled();
  });

  it("lists through the task router as the token's address only", async () => {
    const res = createMockResponse();
    await handler(
      { method: "GET", headers: makeBearerAuth(), query: { walletId: "wallet-1", address: HUMAN_ADDRESS } } as unknown as NextApiRequest,
      res,
    );
    expect(createCallerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionAddress: HUMAN_ADDRESS,
        sessionWallets: [HUMAN_ADDRESS],
        primaryWallet: HUMAN_ADDRESS,
      }),
    );
    expect(taskListMock).toHaveBeenCalledWith({ walletId: "wallet-1" });
    expect(getBotWalletAccessMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("maps the router's FORBIDDEN onto 403 with its message", async () => {
    (taskListMock as any).mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this wallet" }),
    );
    const res = createMockResponse();
    await handler(
      { method: "GET", headers: makeBearerAuth(), query: { walletId: "wallet-1", address: HUMAN_ADDRESS } } as unknown as NextApiRequest,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Not authorized for this wallet", code: "FORBIDDEN" });
  });
});
