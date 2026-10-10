import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { TxSpec } from "@/lib/tx-review/spec";

/**
 * The staking half of the shared preview/propose pipeline: when the account
 * lookup runs, how its failure surfaces, and how a missing registration is
 * added to the spec so the draft token carries it.
 */

const fetchStakeAccountStatusMock = jest.fn<(...args: any[]) => Promise<{ active: boolean; poolId: string | null }>>();
const fetchDrepStatusMock = jest.fn<(...args: any[]) => Promise<{ active: boolean }>>();
const getProviderMock = jest.fn<(network: number) => unknown>();

jest.mock("@/lib/staking/stake-account-status", () => ({
  __esModule: true,
  fetchStakeAccountStatus: fetchStakeAccountStatusMock,
}));
jest.mock("@/lib/governance/drep-status", () => ({
  __esModule: true,
  fetchDrepStatus: fetchDrepStatusMock,
}));
jest.mock("@/utils/get-provider", () => ({ __esModule: true, getProvider: getProviderMock }));

const POOL = "f".repeat(56);

function spec(certificates: TxSpec["certificates"]): TxSpec {
  return {
    v: 1,
    walletId: "wallet-1",
    outputs: [],
    certificates,
    votes: [],
    description: "",
    metadataMessage: "",
  };
}

const stakeCtx = {
  network: 0 as const,
  stake: { rewardAddress: "stake_test1uqx", stakeScriptCbor: "8202" },
} as unknown as import("@/lib/tx-review/context").ReviewWalletContext;

const drepCtx = {
  network: 1 as const,
  drep: { dRepId: "drep1x", drepScriptCbor: "8201" },
} as unknown as import("@/lib/tx-review/context").ReviewWalletContext;

const oneVote: TxSpec["votes"] = [
  { govActionTxHash: "c".repeat(64), govActionIndex: 0, voteKind: "Yes" },
];

let pipeline: typeof import("@/lib/tx-review/pipeline");

beforeEach(async () => {
  jest.clearAllMocks();
  getProviderMock.mockReturnValue({ tag: "provider" });
  pipeline = await import("@/lib/tx-review/pipeline");
});

describe("loadStakeAccountActive", () => {
  it("skips the lookup when there is nothing to check", async () => {
    await expect(pipeline.loadStakeAccountActive(stakeCtx, spec([]))).resolves.toBeUndefined();
    await expect(
      pipeline.loadStakeAccountActive({ ...stakeCtx, stake: undefined }, spec([{ kind: "DelegateStake", poolId: POOL }])),
    ).resolves.toBeUndefined();
    expect(fetchStakeAccountStatusMock).not.toHaveBeenCalled();
  });

  it("asks the wallet network's provider about the reward address", async () => {
    fetchStakeAccountStatusMock.mockResolvedValue({ active: false, poolId: null });
    await expect(
      pipeline.loadStakeAccountActive(stakeCtx, spec([{ kind: "DelegateStake", poolId: POOL }])),
    ).resolves.toBe(false);
    expect(getProviderMock).toHaveBeenCalledWith(0);
    expect(fetchStakeAccountStatusMock).toHaveBeenCalledWith({ tag: "provider" }, "stake_test1uqx");
  });

  it("turns a lookup failure into a STAKE_LOOKUP_FAILED tool error", async () => {
    fetchStakeAccountStatusMock.mockRejectedValue(new Error("Blockfrost 500"));
    await expect(
      pipeline.loadStakeAccountActive(stakeCtx, spec([{ kind: "DelegateStake", poolId: POOL }])),
    ).rejects.toMatchObject({ status: 502, code: "STAKE_LOOKUP_FAILED", message: expect.stringContaining("Blockfrost 500") });
  });
});

describe("loadDrepRegistered", () => {
  it("skips the lookup when there is nothing to check", async () => {
    await expect(pipeline.loadDrepRegistered(drepCtx, spec([]))).resolves.toBeUndefined();
    // No DRep identity at all is vote-drep-missing's job, not a lookup.
    await expect(
      pipeline.loadDrepRegistered({ ...drepCtx, drep: undefined }, { ...spec([]), votes: oneVote }),
    ).resolves.toBeUndefined();
    expect(fetchDrepStatusMock).not.toHaveBeenCalled();
  });

  it("asks the wallet network's provider about the DRep id", async () => {
    fetchDrepStatusMock.mockResolvedValue({ active: false });
    await expect(
      pipeline.loadDrepRegistered(drepCtx, { ...spec([]), votes: oneVote }),
    ).resolves.toBe(false);
    expect(getProviderMock).toHaveBeenCalledWith(1);
    expect(fetchDrepStatusMock).toHaveBeenCalledWith({ tag: "provider" }, "drep1x");

    fetchDrepStatusMock.mockResolvedValue({ active: true });
    await expect(
      pipeline.loadDrepRegistered(drepCtx, { ...spec([]), votes: oneVote }),
    ).resolves.toBe(true);
  });

  it("turns a lookup failure into a DREP_LOOKUP_FAILED tool error", async () => {
    fetchDrepStatusMock.mockRejectedValue(new Error("Blockfrost 500"));
    await expect(
      pipeline.loadDrepRegistered(drepCtx, { ...spec([]), votes: oneVote }),
    ).rejects.toMatchObject({ status: 502, code: "DREP_LOOKUP_FAILED", message: expect.stringContaining("Blockfrost 500") });
  });
});

describe("validateOrThrow", () => {
  it("refuses a vote from an unregistered DRep with a message that says so", () => {
    const { specToDraft } = jest.requireActual("@/lib/tx-review/spec") as typeof import("@/lib/tx-review/spec");
    const draft = specToDraft({ ...spec([]), votes: oneVote }, "d1");
    const ctx = { ...drepCtx, walletAddress: "addr1qpwallet" };

    expect(() => pipeline.validateOrThrow(draft, ctx, [], undefined, false)).toThrow(
      expect.objectContaining({
        status: 400,
        code: "INVALID_DRAFT",
        message: expect.stringContaining("not registered as a DRep"),
        details: { issues: [expect.objectContaining({ code: "vote-drep-unregistered" })] },
      }),
    );
    // Registered, or unknown, passes the vote through.
    expect(pipeline.validateOrThrow(draft, ctx, [], undefined, true)).toEqual([]);
    expect(pipeline.validateOrThrow(draft, ctx, [], undefined, undefined)).toEqual([]);
  });
});

describe("ensureStakeRegistration", () => {
  const delegateOnly = spec([{ kind: "DelegateStake", poolId: POOL }]);

  it("adds a RegisterStake ahead of a delegation for an unregistered credential", () => {
    const result = pipeline.ensureStakeRegistration(delegateOnly, false);
    expect(result.added).toBe(true);
    expect(result.spec.certificates).toEqual([{ kind: "RegisterStake" }, { kind: "DelegateStake", poolId: POOL }]);
    // Pure: the requested spec is untouched.
    expect(delegateOnly.certificates).toHaveLength(1);
  });

  it("changes nothing when the credential is registered or the state is unknown", () => {
    expect(pipeline.ensureStakeRegistration(delegateOnly, true)).toEqual({ spec: delegateOnly, added: false });
    expect(pipeline.ensureStakeRegistration(delegateOnly, undefined)).toEqual({ spec: delegateOnly, added: false });
  });

  it("does not double up a registration the model already included", () => {
    const paired = spec([{ kind: "DelegateStake", poolId: POOL }, { kind: "RegisterStake" }]);
    expect(pipeline.ensureStakeRegistration(paired, false)).toEqual({ spec: paired, added: false });
  });

  it("never invents a registration without a delegation to enable", () => {
    const deregister = spec([{ kind: "DeregisterStake" }]);
    expect(pipeline.ensureStakeRegistration(deregister, false)).toEqual({ spec: deregister, added: false });
    expect(pipeline.ensureStakeRegistration(spec([]), false)).toEqual({ spec: spec([]), added: false });
  });
});
