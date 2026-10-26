import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

// The dApp cards on the landing page and /dapps fetch an allow-listed site's
// OpenGraph tags through /api/local/og and its images through
// /api/local/proxy. Both endpoints are public. These tests pin down what they
// must not do:
//   - follow a redirect off the allow-list,
//   - relay anything but an image from our origin (an HTML page or script
//     served from here runs as us),
//   - let an SVG they relay run scripts when opened directly,
//   - buffer an unbounded body, or let a slow body outlive the deadline.

jest.mock("@/lib/security/rateLimit", () => ({
  checkRateLimit: () => true,
  getClientIP: () => "203.0.113.7",
}));

import {
  cappedFetch,
  CappedFetchError,
  isImageContentType,
} from "@/lib/security/cappedFetch";
import proxyHandler from "@/pages/api/local/proxy";
import ogHandler from "@/pages/api/local/og";

const fetchMock = jest.fn<typeof fetch>();
const realFetch = global.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

const bytes = (n: number) => new Uint8Array(n).fill(0x61);

/** A body delivered in chunks, without a content-length header. */
function chunkedBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((payload: unknown) => {
      res.body = payload;
      return res;
    }),
    send: jest.fn((payload: unknown) => {
      res.body = payload;
      return res;
    }),
    setHeader: jest.fn((name: string, value: string) => {
      res.headers[name.toLowerCase()] = value;
      return res;
    }),
  };
  return res;
}

function makeReq(query: Record<string, string>): NextApiRequest {
  return { method: "GET", headers: {}, query } as unknown as NextApiRequest;
}

async function callProxy(src: string) {
  const res = makeRes();
  await proxyHandler(makeReq({ src }), res as unknown as NextApiResponse);
  return res;
}

async function callOg(url: string) {
  const res = makeRes();
  await ogHandler(makeReq({ url }), res as unknown as NextApiResponse);
  return res;
}

describe("cappedFetch", () => {
  const base = { maxBytes: 10, timeoutMs: 1000 } as const;

  it("asks fetch not to follow redirects, and fails on a 3xx", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
    );
    await expect(
      cappedFetch("https://fluidtokens.com/x", { ...base, overflow: "reject" }),
    ).rejects.toMatchObject({ reason: "redirect" });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("fails on a non-2xx status", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(
      cappedFetch("https://fluidtokens.com/x", { ...base, overflow: "reject" }),
    ).rejects.toMatchObject({ reason: "status" });
  });

  it("checks the content type before reading the body", async () => {
    fetchMock.mockResolvedValue(
      new Response("<script>alert(1)</script>", { headers: { "content-type": "text/html" } }),
    );
    await expect(
      cappedFetch("https://fluidtokens.com/x", {
        ...base,
        overflow: "reject",
        acceptContentType: isImageContentType,
      }),
    ).rejects.toMatchObject({ reason: "content_type" });
  });

  it("rejects a body whose declared length is over the cap", async () => {
    fetchMock.mockResolvedValue(
      new Response(bytes(11), { headers: { "content-length": "11" } }),
    );
    await expect(
      cappedFetch("https://fluidtokens.com/x", { ...base, overflow: "reject" }),
    ).rejects.toMatchObject({ reason: "too_large" });
  });

  it("rejects an undeclared body once it streams past the cap", async () => {
    fetchMock.mockImplementation(async () => new Response(chunkedBody([bytes(6), bytes(6)])));
    await expect(
      cappedFetch("https://fluidtokens.com/x", { ...base, overflow: "reject" }),
    ).rejects.toEqual(expect.objectContaining({ reason: "too_large" }));
    await expect(
      cappedFetch("https://fluidtokens.com/x", { ...base, overflow: "reject" }).catch((e) => e),
    ).resolves.toBeInstanceOf(CappedFetchError);
  });

  it("truncates instead when asked to", async () => {
    fetchMock.mockResolvedValue(new Response(chunkedBody([bytes(6), bytes(6), bytes(6)])));
    const result = await cappedFetch("https://fluidtokens.com/x", {
      ...base,
      overflow: "truncate",
    });
    expect(result.body.length).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it("returns a body within the cap untouched", async () => {
    fetchMock.mockResolvedValue(
      new Response(bytes(10), { headers: { "content-type": "image/png" } }),
    );
    const result = await cappedFetch("https://fluidtokens.com/x", {
      ...base,
      overflow: "reject",
    });
    expect(result).toMatchObject({ contentType: "image/png", truncated: false });
    expect(result.body.length).toBe(10);
  });

  it("keeps the deadline running while the body is read", async () => {
    // Headers arrive at once; the body never finishes. The abort signal must
    // still fire, as it does for undici, which errors the body stream.
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = init?.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes(1));
          signal.addEventListener("abort", () => controller.error(signal.reason));
        },
      });
      return new Response(body);
    });
    await expect(
      cappedFetch("https://fluidtokens.com/x", {
        maxBytes: 100,
        timeoutMs: 50,
        overflow: "reject",
      }),
    ).rejects.toThrow();
  });
});

describe("isImageContentType", () => {
  it.each([
    "image/png",
    "image/jpeg",
    "image/svg+xml",
    "image/vnd.microsoft.icon",
    "IMAGE/PNG; charset=binary",
  ])("accepts %s", (type) => {
    expect(isImageContentType(type)).toBe(true);
  });

  it.each([
    "text/html",
    "application/javascript",
    "application/octet-stream",
    "image",
    "image/",
    "text/html; x=image/png",
  ])("refuses %s", (type) => {
    expect(isImageContentType(type)).toBe(false);
  });
});

describe("/api/local/proxy", () => {
  it("relays an image with a sandbox CSP, so an SVG opened directly cannot script", async () => {
    fetchMock.mockResolvedValue(
      new Response("<svg xmlns='http://www.w3.org/2000/svg'/>", {
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    const res = await callProxy("https://fluidtokens.com/assets/images/logos/logo.svg");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/svg+xml");
    expect(res.headers["content-security-policy"]).toMatch(/\bsandbox\b/);
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'none'/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.isBuffer(res.body)).toBe(true);
  });

  it("refuses to relay an HTML page from an allowed host", async () => {
    fetchMock.mockResolvedValue(
      new Response("<script>steal()</script>", { headers: { "content-type": "text/html" } }),
    );
    const res = await callProxy("https://fluidtokens.com/");
    expect(res.statusCode).toBe(502);
    expect(res.send).not.toHaveBeenCalled();
    expect(res.headers["content-type"]).toBeUndefined();
  });

  it("does not follow an allowed host's redirect to another host", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://evil.example/x.png" } }),
    );
    const res = await callProxy("https://fluidtokens.com/redirect");
    expect(res.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("refuses an image over the size cap", async () => {
    const tooBig = 5 * 1024 * 1024 + 1;
    fetchMock.mockResolvedValue(
      new Response(null, {
        headers: { "content-type": "image/png", "content-length": String(tooBig) },
      }),
    );
    const res = await callProxy("https://fluidtokens.com/huge.png");
    expect(res.statusCode).toBe(502);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("answers an upstream timeout with 504, without image headers", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const res = await callProxy("https://fluidtokens.com/slow.png");
    expect(res.statusCode).toBe(504);
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("still refuses hosts off the allow-list without fetching", async () => {
    const res = await callProxy("https://evil.example/x.png");
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/api/local/og", () => {
  it("returns the page's metadata with images routed through the proxy", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `<html><head><title>Fluid</title>
         <meta property="og:image" content="/og.jpg">
         <link rel="icon" href="/favicon.png"></head></html>`,
        { headers: { "content-type": "text/html" } },
      ),
    );
    const res = await callOg("https://fluidtokens.com/");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      title: "Fluid",
      description: null,
      image: `/api/local/proxy?src=${encodeURIComponent("https://fluidtokens.com/og.jpg")}`,
      favicon: `/api/local/proxy?src=${encodeURIComponent("https://fluidtokens.com/favicon.png")}`,
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("does not follow a redirect", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 301, headers: { location: "http://10.0.0.1/" } }),
    );
    const res = await callOg("https://fluidtokens.com/");
    expect(res.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads metadata from the first MiB of an oversized page, and no further", async () => {
    const head = new TextEncoder().encode(`<head><title>Big</title></head>`);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // An endless page in 64 KiB chunks: only a reader that stops can finish.
        controller.enqueue(pulled === 0 ? head : bytes(64 * 1024));
        pulled += 1;
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { headers: { "content-type": "text/html" } }));
    const res = await callOg("https://fluidtokens.com/");
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ title: "Big" });
    expect(pulled).toBeLessThan(20);
  });

  it("answers an upstream timeout with 504", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const res = await callOg("https://fluidtokens.com/");
    expect(res.statusCode).toBe(504);
  });
});
