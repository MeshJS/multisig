import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD: "preprodKEY123",
    NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET: "mainnetKEY456",
  },
}));

import {
  fetchDrepProfile,
  isBlockfrostNotFound,
} from "@/lib/governance/drep-profile";
import { getBlockfrostReader } from "@/utils/blockfrost-get";

/**
 * The public DRep explorer reads a DRep's record and its metadata. The two
 * reads are independent and must run in parallel; a DRep without metadata is
 * normal and must not be reported as an error; a DRep Blockfrost does not know
 * is "no record", not a crash. These run against the real light reader, so
 * the rejection shape it produces (a JSON string) is the one under test.
 */
describe("fetchDrepProfile", () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock<typeof fetch>;
  let warn: ReturnType<typeof jest.spyOn>;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const notFound = () =>
    json(404, { status_code: 404, error: "Not Found", message: "Not found" });

  /** Route by URL so the test does not depend on request order. */
  const route = (handlers: {
    details: () => Response | Promise<Response>;
    metadata: () => Response | Promise<Response>;
  }) =>
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      return url.endsWith("/metadata/") ? handlers.metadata() : handlers.details();
    });

  const record = {
    drep_id: "drep1abc",
    hex: "ab",
    amount: "5000000",
    active: true,
    active_epoch: 500,
    has_script: false,
  };
  const meta = { drep_id: "drep1abc", json_metadata: { body: { givenName: "Ada" } } };

  beforeEach(() => {
    fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    global.fetch = realFetch;
    warn.mockRestore();
  });

  it("requests the record and the metadata at the same time", async () => {
    // Neither response arrives until both requests have been made: a serial
    // implementation would wait on the first forever and never send the second.
    const release: Array<() => void> = [];
    const gate = (res: Response) =>
      new Promise<Response>((resolve) => release.push(() => resolve(res)));
    route({ details: () => gate(json(200, record)), metadata: () => gate(json(200, meta)) });

    const pending = fetchDrepProfile(getBlockfrostReader(1), "drep1abc");
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    release.forEach((go) => go());

    await expect(pending).resolves.toEqual({ details: record, metadata: meta });
    expect(fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      "https://cardano-mainnet.blockfrost.io/api/v0/governance/dreps/drep1abc",
      "https://cardano-mainnet.blockfrost.io/api/v0/governance/dreps/drep1abc/metadata/",
    ]);
  });

  it("returns the record without metadata, silently, when none is published", async () => {
    route({ details: () => json(200, record), metadata: notFound });
    await expect(
      fetchDrepProfile(getBlockfrostReader(1), "drep1abc"),
    ).resolves.toEqual({ details: record, metadata: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the record and warns when metadata fails for another reason", async () => {
    route({ details: () => json(200, record), metadata: () => json(500, { status_code: 500 }) });
    await expect(
      fetchDrepProfile(getBlockfrostReader(1), "drep1abc"),
    ).resolves.toEqual({ details: record, metadata: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("answers 'no record' for a DRep Blockfrost does not know", async () => {
    route({ details: notFound, metadata: notFound });
    await expect(
      fetchDrepProfile(getBlockfrostReader(0), "drep1unknown"),
    ).resolves.toEqual({ details: null, metadata: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it("rethrows any other failure reading the record", async () => {
    route({ details: () => json(429, { status_code: 429 }), metadata: () => json(200, meta) });
    await expect(
      fetchDrepProfile(getBlockfrostReader(1), "drep1abc"),
    ).rejects.toEqual(expect.stringContaining('"status":429'));
    // One failure, reported once — by the caller, not also as a metadata warning.
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts bech32 and hex ids, trimmed", async () => {
    route({ details: notFound, metadata: notFound });
    await fetchDrepProfile(getBlockfrostReader(1), " drep_script1qx9 ");
    await fetchDrepProfile(getBlockfrostReader(1), "a1b2c3");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      "https://cardano-mainnet.blockfrost.io/api/v0/governance/dreps/drep_script1qx9",
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(["..", ".", "../../accounts/stake1x", "drep1x?count=100", "", "drep1x/metadata"])(
    "answers 'no record' without a request for an id that cannot be a DRep: %j",
    async (bad) => {
      await expect(
        fetchDrepProfile(getBlockfrostReader(1), bad),
      ).resolves.toEqual({ details: null, metadata: null });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe("isBlockfrostNotFound", () => {
  it("recognises the light reader's JSON-string rejection", () => {
    expect(isBlockfrostNotFound(JSON.stringify({ data: {}, status: 404 }))).toBe(true);
    expect(isBlockfrostNotFound(JSON.stringify({ data: {}, status: 500 }))).toBe(false);
  });

  it("recognises the object shapes other providers reject with", () => {
    expect(isBlockfrostNotFound({ status: 404 })).toBe(true);
    expect(isBlockfrostNotFound({ response: { status: 404 } })).toBe(true);
    expect(isBlockfrostNotFound({ data: { status_code: 404 } })).toBe(true);
  });

  it("does not read a network failure or plain text as a 404", () => {
    expect(isBlockfrostNotFound(JSON.stringify({ message: "fetch failed" }))).toBe(false);
    expect(isBlockfrostNotFound("404")).toBe(false);
    expect(isBlockfrostNotFound(new Error("boom"))).toBe(false);
    expect(isBlockfrostNotFound(null)).toBe(false);
  });
});
