import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

// SSRF tripwire suite for /api/v1/og
//
// The handler must reject:
//   - non-https URLs
//   - hosts not on the allowlist
//   - hosts that resolve to private / loopback / link-local addresses
//   - upstream redirects (no auto-follow)
//
// The most important regression is the IMDS URL case:
//   http://169.254.169.254/latest/meta-data/  (AWS instance metadata)
// — historically the canonical SSRF target. If this ever returns 200, an
// attacker who can hit our public OG endpoint can pivot into cloud metadata.

const dnsLookupMock = jest.fn() as jest.MockedFunction<
  (host: string, opts?: unknown) => Promise<Array<{ address: string; family: number }>>
>;

jest.unstable_mockModule("dns", () => ({
  __esModule: true,
  default: { promises: { lookup: dnsLookupMock } },
  promises: { lookup: dnsLookupMock },
}));

const envState: { OG_ALLOWED_HOSTS?: string } = {};
jest.unstable_mockModule("@/env", () => ({
  __esModule: true,
  env: new Proxy({}, {
    get(_t, key: string) {
      if (key === "OG_ALLOWED_HOSTS") return envState.OG_ALLOWED_HOSTS;
      return undefined;
    },
  }),
}));

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
const realFetch = global.fetch;

function makeRes() {
  const status = jest.fn();
  const json = jest.fn();
  const setHeader = jest.fn();
  const res = {
    status: status.mockImplementation(() => res),
    json: json.mockImplementation(() => res),
    setHeader,
  } as unknown as NextApiResponse;
  return { res, status, json };
}

// Each request comes from its own address unless a test says otherwise, so
// the per-IP rate limit only bites in the test that is about it.
let nextIp = 0;
function makeReq(
  url: string | undefined,
  opts: { method?: string; ip?: string } = {},
): NextApiRequest {
  return {
    query: url === undefined ? {} : { url },
    method: opts.method ?? "GET",
    headers: { "x-forwarded-for": opts.ip ?? `test-client-${++nextIp}` },
  } as unknown as NextApiRequest;
}

const handlerPromise = import("../pages/api/v1/og");

beforeEach(() => {
  dnsLookupMock.mockReset();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  envState.OG_ALLOWED_HOSTS = undefined;
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("og handler — SSRF defense", () => {
  it("rejects missing url with 400", async () => {
    const { default: handler } = await handlerPromise;
    const { res, status, json } = makeRes();
    await handler(makeReq(undefined), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/missing/i) }));
  });

  it("rejects http:// URLs with 400", async () => {
    const { default: handler } = await handlerPromise;
    const { res, status } = makeRes();
    await handler(makeReq("http://github.com/example"), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects IMDS URL (http://169.254.169.254/...) — TRIPWIRE", async () => {
    // This test is the one we never let regress. AWS instance metadata URL.
    // Even if someone allowlists `*` for OG_ALLOWED_HOSTS, the http:// scheme
    // check rejects this immediately. No DNS lookup, no fetch.
    const { default: handler } = await handlerPromise;
    const { res, status } = makeRes();
    await handler(makeReq("http://169.254.169.254/latest/meta-data/"), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects https IMDS-style URL when wildcard hosts but private IP", async () => {
    // Even with OG_ALLOWED_HOSTS=*, the DNS / address-class check must reject
    // direct private-IP literals, including the link-local 169.254.0.0/16.
    envState.OG_ALLOWED_HOSTS = "*";
    const { default: handler } = await handlerPromise;
    const { res, status, json } = makeRes();
    await handler(makeReq("https://169.254.169.254/"), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/private|loopback/i) }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an explicit non-default port even on an allowlisted host", async () => {
    // Port pinning: without it, an allowlisted (or wildcarded) host could be
    // used to probe arbitrary services, e.g. https://github.com:8443/.
    envState.OG_ALLOWED_HOSTS = "github.com";
    const { default: handler } = await handlerPromise;
    const { res, status, json } = makeRes();
    await handler(makeReq("https://github.com:8443/example"), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/port/i) }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an explicit :443 (normalised to the default port)", async () => {
    envState.OG_ALLOWED_HOSTS = "example.com";
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    fetchMock.mockResolvedValueOnce(new Response("<html></html>", { status: 200 }));
    const { default: handler } = await handlerPromise;
    const { res, status } = makeRes();
    await handler(makeReq("https://example.com:443/page"), res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("rejects host not on the allowlist with 400", async () => {
    envState.OG_ALLOWED_HOSTS = "github.com,x.com";
    const { default: handler } = await handlerPromise;
    const { res, status } = makeRes();
    await handler(makeReq("https://evil.example.com/"), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when DNS resolves to an RFC1918 address", async () => {
    envState.OG_ALLOWED_HOSTS = "internal.example.com";
    dnsLookupMock.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    const { default: handler } = await handlerPromise;
    const { res, status, json } = makeRes();
    await handler(makeReq("https://internal.example.com/"), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/private|loopback/i) }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when upstream returns a redirect (no auto-follow)", async () => {
    envState.OG_ALLOWED_HOSTS = "github.com";
    dnsLookupMock.mockResolvedValueOnce([{ address: "140.82.114.4", family: 4 }]);
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
    );
    const { default: handler } = await handlerPromise;
    const { res, status } = makeRes();
    await handler(makeReq("https://github.com/example"), res);
    expect(status).toHaveBeenCalledWith(502);
  });

  it("returns 200 with extracted OG metadata for an allowlisted public host", async () => {
    envState.OG_ALLOWED_HOSTS = "example.com";
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    const html = `<html><head>
      <meta property="og:title" content="Hello"/>
      <meta property="og:description" content="World"/>
      <meta property="og:image" content="https://example.com/img.png"/>
      <meta property="og:site_name" content="Example"/>
    </head></html>`;
    fetchMock.mockResolvedValueOnce(new Response(html, { status: 200 }));
    const { default: handler } = await handlerPromise;
    const { res, status, json } = makeRes();
    await handler(makeReq("https://example.com/page"), res);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Hello",
        description: "World",
        image: "https://example.com/img.png",
        siteName: "Example",
      }),
    );
  });
});

describe("og handler — request bounds", () => {
  it("answers anything but GET with 405 and fetches nothing", async () => {
    const { default: handler } = await handlerPromise;
    const { res, status } = makeRes();
    await handler(makeReq("https://github.com/x", { method: "POST" }), res);
    expect(status).toHaveBeenCalledWith(405);
    expect(res.setHeader).toHaveBeenCalledWith("Allow", "GET");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate-limits one address to 20 lookups a minute", async () => {
    // Every request is an outbound fetch made on the caller's behalf, with no
    // authentication in front of it.
    const { default: handler } = await handlerPromise;
    const ip = "203.0.113.77";
    for (let i = 0; i < 20; i++) {
      const { res, status } = makeRes();
      await handler(makeReq(undefined, { ip }), res);
      expect(status).toHaveBeenCalledWith(400);
    }
    const { res, status } = makeRes();
    await handler(makeReq("https://github.com/x", { ip }), res);
    expect(status).toHaveBeenCalledWith(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("og handler — upstream failures are gateway errors, not 500s", () => {
  beforeEach(() => {
    envState.OG_ALLOWED_HOSTS = "example.com";
    dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  it("reports an upstream error status as 502", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    const { default: handler } = await handlerPromise;
    const { res, status, json } = makeRes();
    await handler(makeReq("https://example.com/missing"), res);
    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith({ error: "Upstream returned 404" });
  });

  it("reports an upstream that misses the deadline as 504", async () => {
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    fetchMock.mockRejectedValueOnce(abort);
    const { default: handler } = await handlerPromise;
    const { res, status } = makeRes();
    await handler(makeReq("https://example.com/slow"), res);
    expect(status).toHaveBeenCalledWith(504);
  });

  it("does not echo a network error's message to the caller", async () => {
    const quiet = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.1.2.3:443"));
      const { default: handler } = await handlerPromise;
      const { res, status, json } = makeRes();
      await handler(makeReq("https://example.com/page"), res);
      expect(status).toHaveBeenCalledWith(502);
      expect(JSON.stringify(json.mock.calls)).not.toMatch(/ECONNREFUSED|10\.1\.2\.3/);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("og handler — metadata extraction", () => {
  beforeEach(() => {
    envState.OG_ALLOWED_HOSTS = "example.com";
    dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  async function extract(html: string) {
    fetchMock.mockResolvedValueOnce(new Response(html, { status: 200 }));
    const { default: handler } = await handlerPromise;
    const { res, status, json } = makeRes();
    await handler(makeReq("https://example.com/page"), res);
    expect(status).toHaveBeenCalledWith(200);
    return json.mock.calls[0]![0] as Record<string, unknown>;
  }

  it("falls back to name= meta tags and then to <title>", async () => {
    expect(
      await extract(`<meta name="description" content="Plain"><title>Doc</title>`),
    ).toEqual(expect.objectContaining({ title: "Doc", description: "Plain" }));
  });

  it("reads content written before property, as many sites do", async () => {
    expect(
      await extract(`<meta content="Reordered" property="og:title" />`),
    ).toEqual(expect.objectContaining({ title: "Reordered" }));
  });

  it("answers within a second for 1 MiB of unterminated <meta openings", async () => {
    // The old per-field regexes rescanned the rest of the page from every
    // `<meta`, so this page held the event loop for minutes. (The other
    // hostile shapes are covered in metaTags.test.ts.)
    const html = ("<meta " + "a".repeat(50)).repeat(Math.floor((1024 * 1024) / 56)) + ">";
    const started = Date.now();
    await extract(html);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

