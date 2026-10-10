import { describe, expect, it, jest } from "@jest/globals";

import { fetchStakeAccountStatus } from "@/lib/staking/stake-account-status";

/**
 * The registration probe shared by the stakeAccountInfo route and the MCP
 * draft pipeline. It reads Blockfrost's raw account record: only `active`
 * counts (a deregistered account keeps its `active_epoch`), a 404 for a
 * never-seen account is the "not active" answer, and any other failure must
 * surface rather than read as inactive.
 */

function provider(impl: (url: string) => Promise<unknown>) {
  return { get: jest.fn(impl) };
}

describe("fetchStakeAccountStatus", () => {
  it("reports a registered, delegated account", async () => {
    const p = provider(async () => ({ active: true, active_epoch: 300, pool_id: "pool1abc" }));
    await expect(fetchStakeAccountStatus(p, " stake_test1uqx ")).resolves.toEqual({
      active: true,
      poolId: "pool1abc",
    });
    expect(p.get).toHaveBeenCalledWith("/accounts/stake_test1uqx");
  });

  it("normalizes a registered but undelegated account", async () => {
    const p = provider(async () => ({ active: true, active_epoch: 300, pool_id: null }));
    await expect(fetchStakeAccountStatus(p, "stake_test1uqx")).resolves.toEqual({
      active: true,
      poolId: null,
    });
  });

  it("treats a deregistered account as inactive even though active_epoch is set", async () => {
    // The case Mesh's fetchAccountInfo gets wrong (active || active_epoch !== null).
    const p = provider(async () => ({ active: false, active_epoch: 310, pool_id: null }));
    await expect(fetchStakeAccountStatus(p, "stake_test1uqx")).resolves.toEqual({
      active: false,
      poolId: null,
    });
  });

  it("treats an account seen on chain but never registered as inactive", async () => {
    const p = provider(async () => ({ active: false, active_epoch: null, pool_id: null }));
    await expect(fetchStakeAccountStatus(p, "stake_test1uqx")).resolves.toEqual({
      active: false,
      poolId: null,
    });
  });

  it("treats a 404 (never seen on chain) as inactive", async () => {
    const byStatus = provider(async () => {
      throw Object.assign(new Error("Not found"), { status: 404 });
    });
    await expect(fetchStakeAccountStatus(byStatus, "stake_test1uqx")).resolves.toEqual({
      active: false,
      poolId: null,
    });

    const byMessage = provider(async () => {
      throw new Error("Request failed with status 404");
    });
    await expect(fetchStakeAccountStatus(byMessage, "stake_test1uqx")).resolves.toEqual({
      active: false,
      poolId: null,
    });
  });

  it("rethrows any other provider failure", async () => {
    const p = provider(async () => {
      throw Object.assign(new Error("Blockfrost 500"), { status: 500 });
    });
    await expect(fetchStakeAccountStatus(p, "stake_test1uqx")).rejects.toThrow("Blockfrost 500");
  });
});
