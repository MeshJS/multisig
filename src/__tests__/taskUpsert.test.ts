import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { TRPCError } from "@trpc/server";
import type { NextApiRequest, NextApiResponse } from "next";

import { createMockResponse, makeBearerAuth } from "./apiTestUtils";

/**
 * POST /api/v1/taskUpsert — the handler behind the `task_upsert` MCP tool.
 *
 * Authorization and validation belong to the `task` router, which the
 * handler runs in-process; what is tested here is the handler's own
 * contract: bots are refused, recipients are converted from display units
 * before they reach the router, create/update/move are sequenced the way
 * the tool documents, and router errors come back as HTTP.
 */

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string) => boolean>();
const applyAddressRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, address: string) => boolean>();
const enforceBodySizeMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, maxBytes: number) => boolean>();
const verifyJwtMock: jest.Mock = jest.fn();
const isBotJwtMock: jest.Mock = jest.fn();
const createCallerMock: jest.Mock = jest.fn();
const taskCreateMock: jest.Mock = jest.fn();
const taskUpdateMock: jest.Mock = jest.fn();
const taskMoveMock: jest.Mock = jest.fn();
const recipientsToBaseUnitsMock: jest.Mock = jest.fn();
const networkFromAddressMock: jest.Mock = jest.fn();

/** Stand-in for the pipeline's error class; the real module pulls Mesh. */
class TxReviewErrorMock extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  toResult() {
    return { status: this.status, body: { error: this.message, code: this.code, ...(this.details ?? {}) } };
  }
}

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  applyBotRateLimit: applyBotRateLimitMock,
  applyAddressRateLimit: applyAddressRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
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

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {},
}));

jest.mock("@/server/api/root", () => ({
  __esModule: true,
  createCaller: createCallerMock,
}));

jest.mock("@/lib/task-payout/recipients", () => ({
  __esModule: true,
  recipientsToBaseUnits: recipientsToBaseUnitsMock,
}));

jest.mock("@/lib/tx-review/context", () => ({
  __esModule: true,
  TxReviewError: TxReviewErrorMock,
  networkFromAddress: networkFromAddressMock,
}));

const HUMAN_ADDRESS = "addr_test1qphumanfixture0000000000000000000000000000000000";

function task(over: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    walletId: "wallet-1",
    title: "Ship it",
    description: null,
    status: "Backlog",
    priority: null,
    assigneeAddress: null,
    dueDate: null,
    position: 0,
    createdBy: HUMAN_ADDRESS,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-02T00:00:00Z"),
    recipients: [],
    payouts: [],
    payout: { state: "none", transactionId: null, txHash: null, payable: false, blocker: "no_recipients" },
    ...over,
  };
}

function request(body: Record<string, unknown>): NextApiRequest {
  return { method: "POST", headers: makeBearerAuth(), body } as unknown as NextApiRequest;
}

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/taskUpsert"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  applyAddressRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue({ address: HUMAN_ADDRESS });
  isBotJwtMock.mockReturnValue(false);
  networkFromAddressMock.mockReturnValue(0);
  (recipientsToBaseUnitsMock as any).mockResolvedValue([]);
  (taskCreateMock as any).mockResolvedValue(task());
  (taskUpdateMock as any).mockResolvedValue(task());
  (taskMoveMock as any).mockResolvedValue(task({ status: "Done", position: 2 }));
  createCallerMock.mockReturnValue({
    task: { create: taskCreateMock, update: taskUpdateMock, move: taskMoveMock },
  });
});

describe("taskUpsert v1 API", () => {
  it("refuses bot keys before touching the board", async () => {
    verifyJwtMock.mockReturnValue({ address: "addr_test1qbot", botId: "bot-1", type: "bot" });
    isBotJwtMock.mockReturnValue(true);
    const res = createMockResponse();
    await handler(request({ walletId: "wallet-1", title: "x" }), res);
    expect(applyBotRateLimitMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(createCallerMock).not.toHaveBeenCalled();
  });

  it("creates a task as the token's address, with recipients converted from display units", async () => {
    (recipientsToBaseUnitsMock as any).mockResolvedValue([
      { address: "addr_test1qrecipient", unit: "lovelace", quantity: "5000000" },
    ]);
    const res = createMockResponse();
    await handler(
      request({
        walletId: "wallet-1",
        title: "Ship it",
        status: "InProgress",
        recipients: [{ address: "addr_test1qrecipient", ada: "5" }],
      }),
      res,
    );
    expect(createCallerMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionAddress: HUMAN_ADDRESS, sessionWallets: [HUMAN_ADDRESS] }),
    );
    expect(recipientsToBaseUnitsMock).toHaveBeenCalledWith(0, "wallet-1", [
      { address: "addr_test1qrecipient", ada: "5" },
    ]);
    expect(taskCreateMock).toHaveBeenCalledWith({
      walletId: "wallet-1",
      title: "Ship it",
      status: "InProgress",
      recipients: [{ address: "addr_test1qrecipient", unit: "lovelace", quantity: "5000000" }],
    });
    expect(taskMoveMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ created: true, task: expect.objectContaining({ id: "task-1" }) }),
    );
  });

  it("creates with an empty recipient list when none is given, then moves when a position is", async () => {
    const res = createMockResponse();
    await handler(request({ walletId: "wallet-1", title: "Ship it", position: 2 }), res);
    expect(recipientsToBaseUnitsMock).not.toHaveBeenCalled();
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipients: [] }),
    );
    expect(taskMoveMock).toHaveBeenCalledWith({ id: "task-1", status: "Backlog", position: 2 });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("requires a title to create", async () => {
    const res = createMockResponse();
    await handler(request({ walletId: "wallet-1", description: "no title" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("updates then moves an existing task when a status is given", async () => {
    const res = createMockResponse();
    await handler(
      request({ walletId: "wallet-1", taskId: "task-1", title: "Renamed", status: "Done", dueDate: null }),
      res,
    );
    expect(taskUpdateMock).toHaveBeenCalledWith({ id: "task-1", title: "Renamed", dueDate: null });
    expect(taskMoveMock).toHaveBeenCalledWith({ id: "task-1", status: "Done", position: 0 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ created: false, task: expect.objectContaining({ status: "Done", position: 2 }) }),
    );
  });

  it("updates without moving when neither status nor position is given", async () => {
    const res = createMockResponse();
    await handler(request({ walletId: "wallet-1", taskId: "task-1", priority: "High" }), res);
    expect(taskUpdateMock).toHaveBeenCalledWith({ id: "task-1", priority: "High" });
    expect(taskMoveMock).not.toHaveBeenCalled();
  });

  it("maps a locked task (router CONFLICT) onto 409", async () => {
    (taskUpdateMock as any).mockRejectedValue(
      new TRPCError({
        code: "CONFLICT",
        message: "This task is locked while its payout is awaiting signatures. Delete the pending transaction first.",
      }),
    );
    const res = createMockResponse();
    await handler(request({ walletId: "wallet-1", taskId: "task-1", title: "x" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CONFLICT", error: expect.stringMatching(/awaiting signatures/) }),
    );
  });

  it("flattens a zod input failure to its first issue", async () => {
    (taskCreateMock as any).mockRejectedValue(
      new TRPCError({
        code: "BAD_REQUEST",
        message: JSON.stringify([
          { path: ["recipients", 0, "address"], message: "Recipient must be a bech32 payment address" },
        ]),
      }),
    );
    const res = createMockResponse();
    await handler(request({ walletId: "wallet-1", title: "x" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "recipients.0.address: Recipient must be a bech32 payment address",
      code: "BAD_REQUEST",
    });
  });

  it("returns the recipient normalizer's INVALID_SPEC with its issue list", async () => {
    (recipientsToBaseUnitsMock as any).mockRejectedValue(
      new TxReviewErrorMock(400, "INVALID_SPEC", "The recipients could not be understood: bad amount", {
        issues: [{ level: "error", message: "bad amount" }],
      }),
    );
    const res = createMockResponse();
    await handler(
      request({ walletId: "wallet-1", title: "x", recipients: [{ address: "addr_test1qrecipient", ada: "abc" }] }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_SPEC", issues: [{ level: "error", message: "bad amount" }] }),
    );
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("requires walletId", async () => {
    const res = createMockResponse();
    await handler(request({ title: "x" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(createCallerMock).not.toHaveBeenCalled();
  });
});
