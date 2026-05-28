import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Readable } from "stream";
import { hashDrepAnchor } from "@meshsdk/core";

jest.mock("node:dns/promises", () => ({
  lookup: jest.fn(() =>
    Promise.resolve([{ address: "8.8.8.8", family: 4 }] as { address: string; family: number }[]),
  ),
}));

// undici.request is the transport used by resolveDRepAnchorFromUrl — the
// previous test mocked global.fetch, but the implementation now pins the
// resolved IP via undici's buildConnector to close the DNS-rebinding TOCTOU.
const requestMock = jest.fn<(...args: unknown[]) => unknown>();
jest.mock("undici", () => ({
  request: (...args: unknown[]) => requestMock(...args),
  Agent: jest.fn(),
  buildConnector: jest.fn(() => () => undefined),
}));

import { resolveDRepAnchorFromUrl } from "@/lib/server/resolveDRepAnchorFromUrl";

function makeResponse(body: string, statusCode = 200) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: Readable.from(Buffer.from(body, "utf8")),
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("resolveDRepAnchorFromUrl", () => {
  it("computes hash from JSON body", async () => {
    const doc = { "@context": "https://example.com", name: "Test" };
    requestMock.mockResolvedValueOnce(makeResponse(JSON.stringify(doc)));

    const r = await resolveDRepAnchorFromUrl("https://example.test/drep.json");
    expect(r.anchorUrl).toBe("https://example.test/drep.json");
    expect(r.anchorDataHash).toBe(hashDrepAnchor(doc as object));
  });

  it("rejects when optional anchorDataHash mismatches", async () => {
    const doc = { x: 1 };
    requestMock.mockResolvedValueOnce(makeResponse(JSON.stringify(doc)));

    await expect(
      resolveDRepAnchorFromUrl("https://example.test/a.json", "deadbeef"),
    ).rejects.toThrow(/anchorDataHash does not match/);
  });
});
