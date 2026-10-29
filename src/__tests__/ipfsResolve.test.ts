import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

// No dedicated Pinata gateway configured: the resolver falls back to the four
// public gateways, in order.
jest.mock("@/env", () => ({ env: {} }));

import handler from "@/pages/api/ipfs/resolve";

const CID = "QmTzQ1Nj5wW3sM1f8Z9d4VqLp2rXh7Yk6BcDeFgHiJkLm";
const MAX_BYTES = 2 * 1024 * 1024;
const CHUNK = 64 * 1024;

type MockRes = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status: jest.Mock<(code: number) => MockRes>;
  json: jest.Mock<(body: unknown) => MockRes>;
  send: jest.Mock<(body: unknown) => MockRes>;
  setHeader: jest.Mock<(name: string, value: string) => MockRes>;
  removeHeader: jest.Mock<(name: string) => void>;
};

function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
  } as MockRes;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.send = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.setHeader = jest.fn((name: string, value: string) => {
    res.headers[name.toLowerCase()] = value;
    return res;
  });
  res.removeHeader = jest.fn((name: string) => {
    delete res.headers[name.toLowerCase()];
  });
  return res;
}

// Each test gets its own client IP so the per-IP rate limiter (module-level
// state) never carries over between tests.
let ipCounter = 0;
async function call(
  query: Record<string, string>,
  { method = "GET", ip }: { method?: string; ip?: string } = {},
) {
  const res = mockRes();
  const req = {
    method,
    query,
    headers: { "x-forwarded-for": ip ?? `203.0.113.${++ipCounter}` },
  } as unknown as NextApiRequest;
  await handler(req, res as unknown as NextApiResponse);
  return res;
}

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  return jest
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init) => impl(String(input), init ?? {}));
}

/**
 * A 4 MB body (twice the cap) produced in 64 KB chunks on demand. Finite, so
 * an implementation that buffers it all fails the assertions instead of
 * hanging the test run.
 */
function oversizedBody() {
  const state = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls++;
      controller.enqueue(new Uint8Array(CHUNK));
      if (state.pulls * CHUNK >= 2 * MAX_BYTES) controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("GET /api/ipfs/resolve", () => {
  it("serves the first gateway's JSON with a pinned content type", async () => {
    const fetchSpy = mockFetch(async () =>
      Response.json({ title: "rationale" }),
    );

    const res = await call({ url: `ipfs://${CID}` });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(res.body))).toEqual({ title: "rationale" });
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toContain("s-maxage=86400");
    // Shared via the CDN, so no per-caller quota headers on it.
    expect(res.headers["x-ratelimit-remaining"]).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      `https://gateway.pinata.cloud/ipfs/${CID}`,
    );
  });

  it("falls through to the next gateway when one answers with an error", async () => {
    const fetchSpy = mockFetch(async (url) =>
      url.startsWith("https://gateway.pinata.cloud/")
        ? new Response("bad gateway", { status: 502 })
        : Response.json({ ok: true }),
    );

    const res = await call({ cid: CID });

    expect(res.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("rejects a declared Content-Length over the cap without reading the body", async () => {
    const { stream, state } = oversizedBody();
    const fetchSpy = mockFetch(
      async () =>
        new Response(stream, {
          headers: { "content-length": String(MAX_BYTES + 1) },
        }),
    );

    const res = await call({ cid: CID });

    expect(res.statusCode).toBe(413);
    expect(state.cancelled).toBe(true);
    // Only the readable stream's initial fill: no attempt to buffer it.
    expect(state.pulls).toBeLessThanOrEqual(1);
    // The same CID is the same file on every gateway — no point asking again.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("stops reading an undeclared body as soon as it passes the cap", async () => {
    const { stream, state } = oversizedBody();
    const fetchSpy = mockFetch(async () => new Response(stream));

    const res = await call({ cid: CID });

    expect(res.statusCode).toBe(413);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(state.cancelled).toBe(true);
    // 2 MB / 64 KB = 32 chunks; a little slack for the stream's read-ahead.
    expect(state.pulls).toBeLessThanOrEqual(MAX_BYTES / CHUNK + 3);
  });

  it("serves a body of exactly the cap", async () => {
    mockFetch(async () => new Response(new Uint8Array(MAX_BYTES)));

    const res = await call({ cid: CID });

    expect(res.statusCode).toBe(200);
    expect((res.body as Buffer).byteLength).toBe(MAX_BYTES);
  });

  it("gives up on a gateway that sends headers and then stalls the body", async () => {
    jest.useFakeTimers();
    const fetchSpy = mockFetch(async (url, init) => {
      if (!url.startsWith("https://gateway.pinata.cloud/")) {
        return Response.json({ from: "second" });
      }
      // Headers arrive at once; the body never does. Like real fetch, the
      // body errors when the request's signal aborts.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("aborted", "AbortError")),
          );
        },
      });
      return new Response(stream);
    });

    const pending = call({ cid: CID });
    await jest.advanceTimersByTimeAsync(6_000);
    const res = await pending;

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(res.body))).toEqual({ from: "second" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("rate-limits a single client and stops calling gateways", async () => {
    const fetchSpy = mockFetch(async () => Response.json({}));
    const ip = "198.51.100.7";

    for (let i = 0; i < 120; i++) {
      expect((await call({ cid: CID }, { ip })).statusCode).toBe(200);
    }
    const limited = await call({ cid: CID }, { ip });

    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(120);
  });

  it("refuses to follow a redirect off the gateway allow-list", async () => {
    const fetchSpy = mockFetch(async (url) =>
      url.startsWith("https://gateway.pinata.cloud/")
        ? new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data" },
          })
        : Response.json({ from: "second" }),
    );

    const res = await call({ cid: CID });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(res.body))).toEqual({ from: "second" });
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("169.254.169.254"))).toBe(false);
  });

  it("rejects invalid references and other methods without fetching", async () => {
    const fetchSpy = mockFetch(async () => Response.json({}));

    expect((await call({ url: "https://example.com/x" })).statusCode).toBe(400);
    const post = await call({ cid: CID }, { method: "POST" });
    expect(post.statusCode).toBe(405);
    expect(post.headers.allow).toBe("GET");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
