import { afterEach, describe, expect, it, jest } from "@jest/globals";

// extractCidPath is pure, but the module imports the validated env object.
jest.mock("@/env", () => ({ env: {} }));

import { extractCidPath, fetchIpfsJson } from "@/lib/ipfs";

const CID = "QmTzQ1Nj5wW3sM1f8Z9d4VqLp2rXh7Yk6BcDeFgHiJkLm";

describe("extractCidPath", () => {
  it("returns a bare CID unchanged", () => {
    expect(extractCidPath(CID)).toBe(CID);
  });

  it("strips the ipfs:// scheme (with or without an ipfs/ prefix)", () => {
    expect(extractCidPath(`ipfs://${CID}`)).toBe(CID);
    expect(extractCidPath(`ipfs://ipfs/${CID}`)).toBe(CID);
  });

  it("extracts cid[/path] after /ipfs/ in a gateway URL", () => {
    expect(extractCidPath(`https://gateway.pinata.cloud/ipfs/${CID}`)).toBe(CID);
    expect(extractCidPath(`https://x.mypinata.cloud/ipfs/${CID}/meta.json`)).toBe(
      `${CID}/meta.json`,
    );
  });

  it("matches the /ipfs/ marker case-insensitively", () => {
    expect(extractCidPath(`https://x/IPFS/${CID}`)).toBe(CID);
  });

  it("drops query/hash and leading slashes", () => {
    expect(extractCidPath(`https://x/ipfs/${CID}?foo=1#bar`)).toBe(CID);
    expect(extractCidPath(`/ipfs/${CID}`)).toBe(CID);
  });

  it("returns null for empty, non-ipfs, too-short, or traversal inputs", () => {
    expect(extractCidPath("")).toBeNull();
    expect(extractCidPath(null)).toBeNull();
    expect(extractCidPath(undefined)).toBeNull();
    expect(extractCidPath("https://example.com/foo")).toBeNull();
    expect(extractCidPath("short")).toBeNull();
    expect(extractCidPath(`https://x/ipfs/${CID}/../secret`)).toBeNull();
  });

  it("terminates quickly on hostile repeated /ipfs/ input (no ReDoS)", () => {
    const hostile = "/ipfs/a".repeat(20000);
    const start = Date.now();
    const result = extractCidPath(hostile);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result).toBeNull();
  });
});

describe("fetchIpfsJson against a rate-limited resolver", () => {
  const tooMany = (retryAfter: string) =>
    Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": retryAfter } },
    );

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("waits out Retry-After and retries an IPFS anchor", async () => {
    jest.useFakeTimers();
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tooMany("5"))
      .mockResolvedValueOnce(Response.json({ body: { comment: "ok" } }));

    const pending = fetchIpfsJson(`ipfs://${CID}`);
    await jest.advanceTimersByTimeAsync(4_999);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({ body: { comment: "ok" } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("gives up after two retries and reports the 429", async () => {
    jest.useFakeTimers();
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => tooMany("1"));

    const pending = fetchIpfsJson(`ipfs://${CID}`);
    const assertion = expect(pending).rejects.toThrow("(429)");
    await jest.advanceTimersByTimeAsync(2_000);
    await assertion;
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-IPFS anchor (not our rate limit)", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => tooMany("1"));

    await expect(fetchIpfsJson("https://example.com/rationale.json")).rejects.toThrow(
      "(429)",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("stops waiting when the caller aborts", async () => {
    jest.useFakeTimers();
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => tooMany("30"));
    const controller = new AbortController();

    const pending = fetchIpfsJson(`ipfs://${CID}`, controller.signal);
    const assertion = expect(pending).rejects.toBeDefined();
    await jest.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await assertion;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
