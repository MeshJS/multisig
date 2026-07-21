import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Unit tests for performClaim's handling of address-less registrations:
 * a PendingBot without a paymentAddress must not create a BotUser at claim
 * time (that happens at the bot's first botAuth) and must report botId null.
 */

let performClaim: typeof import("../lib/auth/claimBot").performClaim;
let sha256: (input: string) => string;

const findPendingBotMock: jest.Mock = jest.fn();
const createBotKeyMock: jest.Mock = jest.fn();
const createBotUserMock: jest.Mock = jest.fn();
const updatePendingBotMock: jest.Mock = jest.fn();
const updateClaimTokenMock: jest.Mock = jest.fn();

const tx = {
  pendingBot: { findUnique: findPendingBotMock, update: updatePendingBotMock },
  botKey: { create: createBotKeyMock },
  botUser: { create: createBotUserMock },
  botClaimToken: { update: updateClaimTokenMock },
} as any;

const CLAIM_CODE = "claim-code-0123456789abcdef";

function pendingBotFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "pending-1",
    name: "Test Bot",
    paymentAddress: null,
    stakeAddress: null,
    requestedScopes: JSON.stringify(["multisig:read"]),
    status: "UNCLAIMED",
    expiresAt: new Date(Date.now() + 60_000),
    claimToken: {
      id: "token-1",
      tokenHash: sha256(CLAIM_CODE),
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    },
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.JWT_SECRET ??= "test-secret-for-claim-bot";
  ({ performClaim } = await import("../lib/auth/claimBot"));
  ({ sha256 } = await import("../lib/auth/botKey"));
});

beforeEach(() => {
  jest.clearAllMocks();
  createBotKeyMock.mockImplementation(async (args: any) => ({ id: "botkey-1", ...args.data }));
  createBotUserMock.mockImplementation(async (args: any) => ({ id: "botuser-1", ...args.data }));
  (updatePendingBotMock as any).mockResolvedValue({});
  (updateClaimTokenMock as any).mockResolvedValue({});
});

describe("performClaim", () => {
  it("claims an address-less registration without creating a BotUser", async () => {
    (findPendingBotMock as any).mockResolvedValue(pendingBotFixture());

    const result = await performClaim(tx, {
      pendingBotId: "pending-1",
      claimCode: CLAIM_CODE,
      approvedScopes: null,
      ownerAddress: "addr_test1owner",
    });

    expect(createBotUserMock).not.toHaveBeenCalled();
    expect(result.botId).toBeNull();
    expect(result.botKeyId).toBe("botkey-1");
    // The claim itself still completes: bot marked CLAIMED with a secret.
    expect(updatePendingBotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CLAIMED" }),
      }),
    );
  });

  it("still creates the BotUser when the registration carried an address", async () => {
    (findPendingBotMock as any).mockResolvedValue(
      pendingBotFixture({ paymentAddress: "addr_test1qpbotclaimfixture0000000000000000000" }),
    );

    const result = await performClaim(tx, {
      pendingBotId: "pending-1",
      claimCode: CLAIM_CODE,
      approvedScopes: null,
      ownerAddress: "addr_test1owner",
    });

    expect(createBotUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentAddress: "addr_test1qpbotclaimfixture0000000000000000000",
          displayName: "Test Bot",
        }),
      }),
    );
    expect(result.botId).toBe("botuser-1");
  });
});
