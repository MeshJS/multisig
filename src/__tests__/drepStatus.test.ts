import { describe, expect, it, jest } from "@jest/globals";

import { fetchDrepStatus } from "@/lib/governance/drep-status";

/**
 * The DRep registration probe behind the MCP draft pipeline's vote check.
 * It reads Blockfrost's raw DRep record: only `active` counts (a retired
 * DRep still has a record), a 404 for a never-registered DRep is the "not
 * active" answer, and any other failure must surface rather than read as
 * inactive.
 */

function provider(impl: (url: string) => Promise<unknown>) {
  return { get: jest.fn(impl) };
}

describe("fetchDrepStatus", () => {
  it("reports a registered DRep", async () => {
    const p = provider(async () => ({ drep_id: "drep1abc", active: true, amount: "1000" }));
    await expect(fetchDrepStatus(p, " drep1abc ")).resolves.toEqual({ active: true });
    expect(p.get).toHaveBeenCalledWith("/governance/dreps/drep1abc");
  });

  it("treats a retired DRep as inactive even though its record exists", async () => {
    const p = provider(async () => ({ drep_id: "drep1abc", active: false, retired: true }));
    await expect(fetchDrepStatus(p, "drep1abc")).resolves.toEqual({ active: false });
  });

  it("treats a record without an active flag as inactive", async () => {
    const p = provider(async () => ({ drep_id: "drep1abc" }));
    await expect(fetchDrepStatus(p, "drep1abc")).resolves.toEqual({ active: false });
    const empty = provider(async () => null);
    await expect(fetchDrepStatus(empty, "drep1abc")).resolves.toEqual({ active: false });
  });

  it("treats a 404 (never registered) as inactive", async () => {
    const byStatus = provider(async () => {
      throw Object.assign(new Error("Not found"), { status: 404 });
    });
    await expect(fetchDrepStatus(byStatus, "drep1abc")).resolves.toEqual({ active: false });

    const byMessage = provider(async () => {
      throw new Error("Request failed with status 404");
    });
    await expect(fetchDrepStatus(byMessage, "drep1abc")).resolves.toEqual({ active: false });
  });

  it("rethrows any other provider failure", async () => {
    const p = provider(async () => {
      throw Object.assign(new Error("Blockfrost 500"), { status: 500 });
    });
    await expect(fetchDrepStatus(p, "drep1abc")).rejects.toThrow("Blockfrost 500");
  });
});
