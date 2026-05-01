import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { hashDrepAnchor } from "@meshsdk/core";

jest.mock("node:dns/promises", () => ({
  lookup: jest.fn(() =>
    Promise.resolve([{ address: "8.8.8.8", family: 4 }] as { address: string; family: number }[]),
  ),
}));

import { resolveDRepAnchorFromUrl } from "@/lib/server/resolveDRepAnchorFromUrl";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe("resolveDRepAnchorFromUrl", () => {
  it("computes hash from JSON body", async () => {
    const doc = { "@context": "https://example.com", name: "Test" };
    const body = JSON.stringify(doc);
    global.fetch = jest.fn(async () => {
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const r = await resolveDRepAnchorFromUrl("https://example.test/drep.json");
    expect(r.anchorUrl).toBe("https://example.test/drep.json");
    expect(r.anchorDataHash).toBe(hashDrepAnchor(doc as object));
  });

  it("rejects when optional anchorDataHash mismatches", async () => {
    const doc = { x: 1 };
    global.fetch = jest.fn(async () => {
      return new Response(JSON.stringify(doc), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      resolveDRepAnchorFromUrl("https://example.test/a.json", "deadbeef"),
    ).rejects.toThrow(/anchorDataHash does not match/);
  });
});
