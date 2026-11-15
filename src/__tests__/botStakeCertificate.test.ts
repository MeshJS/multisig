import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse, makeBearerAuth } from "./apiTestUtils";

/**
 * POST /api/v1/botStakeCertificate — which certificates a delegation carries.
 *
 * A delegation leaves the stake credential with a DRep: an explicit `dRep` is
 * always applied, and an omitted one defaults to Auto-Abstain. But a pool
 * re-delegation on a credential that already delegates its vote must keep that
 * DRep, the way the staking page does — otherwise a call that only meant to
 * change pools (every call from a bot written before `dRep` existed) silently
 * replaces the wallet's chosen DRep with Abstain.
 */

const SIGNER = "addr_test1qsigner";
const REWARD_ADDRESS = "stake_test1uwallet";
// normalizePoolIdForDelegation passes a valid bech32 pool id through unchanged.
const POOL_ID = "pool1424242424242424242424242424242424242424242425m6wpt0";
const EXISTING_DREP = "drep1existing";

type Call = { method: string; args: unknown[] };

/** How Mesh's BlockfrostProvider.get rejects: the response as a JSON string, not an Error. */
const meshRejection = (status: number) =>
  JSON.stringify({
    data: { status_code: status, error: "upstream", message: "upstream detail" },
    headers: { "x-internal": "provider-header" },
    status,
  });

const providerGetMock = jest.fn<(url: string) => Promise<unknown>>();
const createPendingMock: jest.Mock = jest.fn();
const findUniqueMock: jest.Mock = jest.fn();
let calls: Call[] = [];

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: jest.fn(),
  cors: jest.fn(async () => undefined),
}));
jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: jest.fn(() => true),
  applyBotRateLimit: jest.fn(() => true),
  enforceBodySize: jest.fn(() => true),
}));
jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: jest.fn(() => ({ address: SIGNER })),
  isBotJwt: jest.fn(() => false),
}));
jest.mock("@/server/db", () => ({
  __esModule: true,
  db: { wallet: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}));
jest.mock("@/lib/server/v1WalletAuth", () => ({
  __esModule: true,
  authorizeWalletSignerForV1Tx: jest.fn(async () => undefined),
}));
jest.mock("@/lib/auth/botAccess", () => ({
  __esModule: true,
  BotAccessError: class BotAccessError extends Error {
    status = 403;
  },
  botHasScope: jest.fn(async () => true),
}));
jest.mock("@/utils/common", () => ({
  __esModule: true,
  getWalletType: () => "sdk",
  buildMultisigWallet: () => ({
    stakingEnabled: () => true,
    getStakeAddress: () => REWARD_ADDRESS,
    getStakingScript: () => "stake-script",
    getScript: () => ({ address: "addr_test1script", scriptCbor: "spend-script" }),
  }),
  buildWallet: () => ({ stakeScriptCbor: undefined, scriptCbor: "spend-script" }),
}));
jest.mock("@/lib/server/walletScriptAddress", () => ({
  __esModule: true,
  resolveWalletScriptAddress: () => "addr_test1script",
}));
jest.mock("@/lib/server/resolveUtxoRefsFromChain", () => ({
  __esModule: true,
  resolveUtxoRefsFromChain: jest.fn(async () => ({
    utxos: [
      {
        input: { txHash: "c".repeat(64), outputIndex: 0 },
        output: { address: "addr_test1script", amount: [{ unit: "lovelace", quantity: "5000000" }] },
      },
    ],
  })),
}));
jest.mock("@/lib/server/createPendingMultisigTransaction", () => ({
  __esModule: true,
  createPendingMultisigTransaction: (...args: unknown[]) => createPendingMock(...args),
}));
jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: () => ({ get: providerGetMock }),
}));
jest.mock("@/utils/get-tx-builder", () => ({
  __esModule: true,
  // Records every builder call so a test can read which certificates the
  // transaction carries, without building real CBOR.
  getTxBuilder: jest.fn(async () => {
    const builder: Record<string, unknown> = {};
    for (const method of [
      "txIn",
      "txInScript",
      "registerStakeCertificate",
      "deregisterStakeCertificate",
      "delegateStakeCertificate",
      "voteDelegationCertificate",
      "certificateScript",
      "changeAddress",
    ]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    builder.complete = async () => "tx-cbor";
    builder.meshTxBuilderBody = {};
    return builder;
  }),
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/botStakeCertificate"));
});

beforeEach(() => {
  calls = [];
  providerGetMock.mockReset();
  createPendingMock.mockReset();
  createPendingMock.mockImplementation(async () => ({ id: "tx-1" }));
  findUniqueMock.mockReset();
  findUniqueMock.mockImplementation(async () => ({
    id: "wallet-1",
    numRequiredSigners: 2,
    type: "atLeast",
  }));
});

function request(body: unknown): NextApiRequest {
  return { method: "POST", headers: makeBearerAuth(), body } as unknown as NextApiRequest;
}

function stakeRequest(extra: Record<string, unknown>): NextApiRequest {
  return request({
    walletId: "wallet-1",
    address: SIGNER,
    utxoRefs: [{ txHash: "c".repeat(64), outputIndex: 0 }],
    ...extra,
  });
}

/** The certificate calls the transaction was built with, in order. */
function certificates(): Array<{ method: string; args: unknown[] }> {
  return calls.filter((c) => c.method.endsWith("Certificate"));
}

function storedDescription(): unknown {
  return (createPendingMock.mock.calls[0]?.[1] as { description?: unknown })?.description;
}

describe("botStakeCertificate delegation and the existing DRep", () => {
  it("keeps the vote delegation when delegate names no dRep and the credential already has one", async () => {
    providerGetMock.mockResolvedValue({ active: true, pool_id: "pool1old", drep_id: EXISTING_DREP });
    const res = createMockResponse();

    await handler(stakeRequest({ action: "delegate", poolId: POOL_ID }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(providerGetMock).toHaveBeenCalledWith(`/accounts/${REWARD_ADDRESS}`);
    expect(certificates()).toEqual([
      { method: "delegateStakeCertificate", args: [REWARD_ADDRESS, POOL_ID] },
    ]);
    // The stored description must not claim a vote delegation the tx lacks.
    expect(storedDescription()).toBe("Delegate stake.");
  });

  it("pairs Auto-Abstain when delegate names no dRep and the credential has none", async () => {
    providerGetMock.mockResolvedValue({ active: true, pool_id: null, drep_id: null });
    const res = createMockResponse();

    await handler(stakeRequest({ action: "delegate", poolId: POOL_ID }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(certificates()).toEqual([
      { method: "delegateStakeCertificate", args: [REWARD_ADDRESS, POOL_ID] },
      { method: "voteDelegationCertificate", args: [{ alwaysAbstain: null }, REWARD_ADDRESS] },
    ]);
    expect(storedDescription()).toBe("Delegate stake and vote.");
  });

  it("treats a never-seen account (404) as having no vote delegation", async () => {
    providerGetMock.mockRejectedValue(meshRejection(404));
    const res = createMockResponse();

    await handler(stakeRequest({ action: "delegate", poolId: POOL_ID }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(certificates().map((c) => c.method)).toEqual([
      "delegateStakeCertificate",
      "voteDelegationCertificate",
    ]);
  });

  it("applies an explicit dRep even over an existing delegation, without looking it up", async () => {
    const res = createMockResponse();

    await handler(
      stakeRequest({ action: "delegate", poolId: POOL_ID, dRep: "Always No Confidence" }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(providerGetMock).not.toHaveBeenCalled();
    expect(certificates()).toEqual([
      { method: "delegateStakeCertificate", args: [REWARD_ADDRESS, POOL_ID] },
      { method: "voteDelegationCertificate", args: [{ alwaysNoConfidence: null }, REWARD_ADDRESS] },
    ]);
  });

  it("answers 502 and builds nothing when the current delegation cannot be read", async () => {
    providerGetMock.mockRejectedValue(meshRejection(500));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = createMockResponse();

    await handler(stakeRequest({ action: "delegate", poolId: POOL_ID }), res);
    errorSpy.mockRestore();

    expect(res.status).toHaveBeenCalledWith(502);
    // Provider internals (body, headers) are logged, never returned.
    expect(res.json).toHaveBeenCalledWith({
      error:
        "Could not check the wallet's current DRep delegation; pass dRep explicitly or retry",
    });
    expect(calls).toEqual([]);
    expect(createPendingMock).not.toHaveBeenCalled();
  });

  it("register_and_delegate pairs Auto-Abstain without a lookup (an unregistered credential has no DRep)", async () => {
    const res = createMockResponse();

    await handler(stakeRequest({ action: "register_and_delegate", poolId: POOL_ID }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(providerGetMock).not.toHaveBeenCalled();
    expect(certificates().map((c) => c.method)).toEqual([
      "registerStakeCertificate",
      "delegateStakeCertificate",
      "voteDelegationCertificate",
    ]);
  });

  it("does not look up the DRep for actions that carry no delegation", async () => {
    const res = createMockResponse();

    await handler(stakeRequest({ action: "deregister" }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(providerGetMock).not.toHaveBeenCalled();
    expect(certificates().map((c) => c.method)).toEqual(["deregisterStakeCertificate"]);
  });
});

describe("botStakeCertificate request validation", () => {
  it("answers a JSON null body with 400, not a 500 from reading its fields", async () => {
    const res = createMockResponse();

    await handler(request(null), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing required field walletId" });
  });

});

describe("fetchVoteDelegation", () => {
  // Imported lazily so the handler suite above loads its mocks first.
  const load = async () =>
    (await import("@/lib/staking/vote-delegation")).fetchVoteDelegation;
  const provider = (impl: () => Promise<unknown>) => ({
    get: jest.fn<(url: string) => Promise<unknown>>(impl),
  });

  it("returns the account's DRep id, trimming the reward address", async () => {
    const fetchVoteDelegation = await load();
    const p = provider(async () => ({ active: true, drep_id: EXISTING_DREP }));
    await expect(fetchVoteDelegation(p, ` ${REWARD_ADDRESS} `)).resolves.toBe(EXISTING_DREP);
    expect(p.get).toHaveBeenCalledWith(`/accounts/${REWARD_ADDRESS}`);
  });

  it("reads a missing, null or empty drep_id (and an empty record) as no delegation", async () => {
    const fetchVoteDelegation = await load();
    for (const record of [
      { active: true },
      { active: true, drep_id: null },
      { active: true, drep_id: "" },
      {},
      null,
    ]) {
      await expect(fetchVoteDelegation(provider(async () => record), REWARD_ADDRESS)).resolves.toBeNull();
    }
  });

  it("ignores a drep_id left on a deregistered (inactive) account", async () => {
    // Deregistration clears the ledger's vote delegation; keeping a stale id
    // would leave a re-registered credential delegated to a pool with no DRep.
    const fetchVoteDelegation = await load();
    const p = provider(async () => ({ active: false, drep_id: EXISTING_DREP }));
    await expect(fetchVoteDelegation(p, REWARD_ADDRESS)).resolves.toBeNull();
  });

  it("reads a 404 as no delegation, in Mesh's string shape and as an object", async () => {
    const fetchVoteDelegation = await load();
    for (const rejection of [meshRejection(404), { status: 404 }]) {
      await expect(
        fetchVoteDelegation(provider(async () => { throw rejection; }), REWARD_ADDRESS),
      ).resolves.toBeNull();
    }
  });

  it("rethrows every other failure, including a 404 mentioned only in free text", async () => {
    const fetchVoteDelegation = await load();
    for (const rejection of [meshRejection(429), meshRejection(500), "socket hang up 404ms", new Error("boom")]) {
      await expect(
        fetchVoteDelegation(provider(async () => { throw rejection; }), REWARD_ADDRESS),
      ).rejects.toBe(rejection);
    }
  });
});
