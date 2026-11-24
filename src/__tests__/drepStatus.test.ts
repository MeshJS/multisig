import { describe, expect, it, jest } from "@jest/globals";

import { fetchDrepStatus } from "@/lib/governance/drep-status";

/**
 * The DRep registration probe behind the MCP draft pipeline's vote check.
 * It reads Blockfrost's raw DRep record: only `active` counts (a retired
 * DRep still has a record), a 404 for a never-registered DRep is the "not
 * active" answer, and any other failure must surface rather than read as
 * inactive.
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

  it("treats Mesh's real 404 rejection — a JSON string, not an Error — as inactive", async () => {
    // Before this case was handled, an MCP vote draft for a never-registered
    // DRep failed as DREP_LOOKUP_FAILED instead of telling the user to
    // register first.
    const p = provider(async () => {
      throw MESH_404;
    });
    await expect(fetchDrepStatus(p, "drep1abc")).resolves.toEqual({ active: false });
  });

  it("rethrows Mesh's string rejection for any other status", async () => {
    const p = provider(async () => {
      throw MESH_500;
    });
    await expect(fetchDrepStatus(p, "drep1abc")).rejects.toBe(MESH_500);
  });

  it("rethrows any other provider failure", async () => {
    const p = provider(async () => {
      throw Object.assign(new Error("Blockfrost 500"), { status: 500 });
    });
    await expect(fetchDrepStatus(p, "drep1abc")).rejects.toThrow("Blockfrost 500");
  });
});
