import { describe, expect, it, jest } from "@jest/globals";

import { fetchStakeAccountStatus } from "@/lib/staking/stake-account-status";

/**
 * The registration probe shared by the stakeAccountInfo route and the MCP
 * draft pipeline. It reads Blockfrost's raw account record: only `active`
 * counts (a deregistered account keeps its `active_epoch`), a 404 for a
 * never-seen account is the "not active" answer, and any other failure must
 * surface rather than read as inactive.
 */

/** What Mesh's BlockfrostProvider.get rejects with (parseHttpError). */
const meshRejection = (status: number) =>
  JSON.stringify({
    data: { status_code: status, error: "x", message: "x" },
    headers: { "content-type": "application/json" },
    status,
  });
const MESH_404 = meshRejection(404);
const MESH_500 = meshRejection(500);

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

  it("treats Mesh's real 404 rejection — a JSON string, not an Error — as inactive", async () => {
    // BlockfrostProvider.get rejects with parseHttpError's JSON.stringify of
    // the axios response. Before this case was handled, every never-registered
    // stake account surfaced as a lookup failure (a 500 from stakeAccountInfo,
    // a 502 STAKE_LOOKUP_FAILED from the MCP draft pipeline).
    const p = provider(async () => {
      throw MESH_404;
    });
    await expect(fetchStakeAccountStatus(p, "stake_test1uqx")).resolves.toEqual({
      active: false,
      poolId: null,
    });
  });

  it("rethrows Mesh's string rejection for any other status", async () => {
    const p = provider(async () => {
      throw MESH_500;
    });
    await expect(fetchStakeAccountStatus(p, "stake_test1uqx")).rejects.toBe(MESH_500);
  });

  it("rethrows any other provider failure", async () => {
    const p = provider(async () => {
      throw Object.assign(new Error("Blockfrost 500"), { status: 500 });
    });
    await expect(fetchStakeAccountStatus(p, "stake_test1uqx")).rejects.toThrow("Blockfrost 500");
  });
});

describe("fetchStakeAccountStatus against Mesh's real BlockfrostProvider", () => {
  // The mocks above copy a rejection shape; this pins it to the library, so a
  // Mesh upgrade that changes how get() rejects shows up here first.
  it("reads Blockfrost's 404 for an unseen account as inactive", async () => {
    const http = await import("node:http");
    const { BlockfrostProvider } = await import("@meshsdk/core");
    const server = http.createServer((_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ status_code: 404, error: "Not Found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    // axios honours HTTP(S)_PROXY even for 127.0.0.1; a proxied dev shell
    // would otherwise send this request somewhere else.
    const savedNoProxy = { upper: process.env.NO_PROXY, lower: process.env.no_proxy };
    process.env.NO_PROXY = process.env.no_proxy = "127.0.0.1,localhost";
    try {
      const { port } = server.address() as { port: number };
      const p = new BlockfrostProvider(`http://127.0.0.1:${port}`);
      await expect(fetchStakeAccountStatus(p, "stake_test1uqx")).resolves.toEqual({
        active: false,
        poolId: null,
      });
    } finally {
      for (const [key, value] of [["NO_PROXY", savedNoProxy.upper], ["no_proxy", savedNoProxy.lower]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
