import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyStrictRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, options?: unknown) => boolean>();
const enforceBodySizeMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, maxBytes: number) => boolean>();

const findBotUserMock: jest.Mock = jest.fn();
const findPendingBotMock: jest.Mock = jest.fn();
const createPendingBotMock: jest.Mock = jest.fn();
const createClaimTokenMock: jest.Mock = jest.fn();

const txClient = {
  pendingBot: { create: createPendingBotMock },
  botClaimToken: { create: createClaimTokenMock },
};

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}), { virtual: true });

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyStrictRateLimit: applyStrictRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}), { virtual: true });

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    botUser: { findUnique: findBotUserMock },
    pendingBot: { findFirst: findPendingBotMock },
    $transaction: (fn: (tx: typeof txClient) => unknown) => fn(txClient),
  },
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  process.env.JWT_SECRET ??= "test-secret-for-bot-register";
  ({ default: handler } = await import("../pages/api/v1/botRegister"));
});

const VALID_ADDRESS = "addr_test1qpbotregisterfixture000000000000000000000000";

function registerRequest(body: Record<string, unknown>): NextApiRequest {
  return { method: "POST", headers: {}, body } as unknown as NextApiRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  applyStrictRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  (findBotUserMock as any).mockResolvedValue(null);
  (findPendingBotMock as any).mockResolvedValue(null);
  createPendingBotMock.mockImplementation(async (args: any) => ({ id: "pending-1", ...args.data }));
  (createClaimTokenMock as any).mockResolvedValue({ id: "token-1" });
});

describe("botRegister API", () => {
  it("registers a bot without a paymentAddress (the initial-registration path)", async () => {
    const res = createMockResponse();

    await handler(
      registerRequest({ name: "Address-less Bot", requestedScopes: ["multisig:read"] }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    // No address → no duplicate-address lookups.
    expect(findBotUserMock).not.toHaveBeenCalled();
    expect(findPendingBotMock).not.toHaveBeenCalled();
    expect(createPendingBotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentAddress: null, name: "Address-less Bot" }),
      }),
    );
    const body = (res.json as jest.Mock).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.pendingBotId).toBe("pending-1");
    expect(typeof body.claimCode).toBe("string");
  });

  it("still registers with a paymentAddress and runs the duplicate checks", async () => {
    const res = createMockResponse();

    await handler(
      registerRequest({
        name: "Wallet Bot",
        paymentAddress: VALID_ADDRESS,
        requestedScopes: ["multisig:read", "multisig:sign"],
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(findBotUserMock).toHaveBeenCalledWith({ where: { paymentAddress: VALID_ADDRESS } });
    expect(createPendingBotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentAddress: VALID_ADDRESS }),
      }),
    );
  });

  it("rejects a provided paymentAddress that is malformed", async () => {
    const res = createMockResponse();

    await handler(
      registerRequest({ name: "Bad Address Bot", paymentAddress: "short", requestedScopes: ["multisig:read"] }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createPendingBotMock).not.toHaveBeenCalled();
  });

  it("rejects a provided paymentAddress that is already registered", async () => {
    (findBotUserMock as any).mockResolvedValue({ id: "existing-bot" });
    const res = createMockResponse();

    await handler(
      registerRequest({ name: "Dup Bot", paymentAddress: VALID_ADDRESS, requestedScopes: ["multisig:read"] }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(createPendingBotMock).not.toHaveBeenCalled();
  });

  it("still requires name and scopes", async () => {
    const res1 = createMockResponse();
    await handler(registerRequest({ requestedScopes: ["multisig:read"] }), res1);
    expect(res1.status).toHaveBeenCalledWith(400);

    const res2 = createMockResponse();
    await handler(registerRequest({ name: "Scopeless Bot", requestedScopes: [] }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });
});
