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

function makeReq(url: string | undefined): NextApiRequest {
  return {
    query: url === undefined ? {} : { url },
    method: "GET",
    headers: {},
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
    expect(status).toHaveBeenCalledWith(500);
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
