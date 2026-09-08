import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { TxSpec } from "@/lib/tx-review/spec";

/**
 * The staking half of the shared preview/propose pipeline: when the account
 * lookup runs, how its failure surfaces, and how a missing registration is
 * added to the spec so the draft token carries it.
 */

const fetchStakeAccountStatusMock = jest.fn<(...args: any[]) => Promise<{ active: boolean; poolId: string | null }>>();
const getProviderMock = jest.fn<(network: number) => unknown>();

jest.mock("@/lib/staking/stake-account-status", () => ({
  __esModule: true,
  fetchStakeAccountStatus: fetchStakeAccountStatusMock,
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
