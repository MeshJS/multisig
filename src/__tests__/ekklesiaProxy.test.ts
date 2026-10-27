import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

jest.mock("@/env", () => ({
  env: { EKKLESIA_API_BASE: "https://ekklesia.example/api" },
}));

import handler from "@/pages/api/ekklesia/[...path]";
import {
  buildUpstreamUrl,
  rewriteSetCookie,
  upstreamCookieHeader,
} from "@/lib/ekklesia/proxy";

const BASE = "https://ekklesia.example/api";

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, unknown>,
    body: undefined as unknown,
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    setHeader: jest.fn((name: string, value: unknown) => {
      res.headers[name.toLowerCase()] = value;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
    send: jest.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

async function call(req: Partial<NextApiRequest>) {
  const res = mockRes();
  await handler(
    { method: "GET", headers: {}, query: {}, ...req } as NextApiRequest,
    res as unknown as NextApiResponse,
  );
  return res;
}

let fetchMock: jest.SpiedFunction<typeof fetch>;

beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function upstreamRequest() {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, headers: (init.headers ?? {}) as Record<string, string> };
}

describe("Ekklesia proxy: our own cookies never leave the origin", () => {
  it("forwards only namespaced Ekklesia cookies, with the namespace removed", async () => {
    await call({
      query: { path: ["v1", "session"] },
      headers: {
        cookie:
          "mesh_wallet_session=our-jwt; next-auth.session-token=our-session; ekklesia_jwt=their-jwt",
      },
    });
    const { headers } = upstreamRequest();
    expect(headers.Cookie).toBe("jwt=their-jwt");
  });

  it("sends no Cookie header when the browser holds no Ekklesia cookie", async () => {
    await call({
      query: { path: ["v1", "ballots"] },
      headers: { cookie: "mesh_wallet_session=our-jwt; __Secure-next-auth.session-token=x" },
    });
    const { headers } = upstreamRequest();
    expect(headers).not.toHaveProperty("Cookie");
  });

  it("still forwards the caller's Ekklesia bearer token", async () => {
    await call({
      query: { path: ["v1", "votes", "b1", "mine"] },
      headers: { authorization: "Bearer ekklesia-token" },
    });
    expect(upstreamRequest().headers.Authorization).toBe("Bearer ekklesia-token");
  });

  it("namespaces Ekklesia's Set-Cookie and scopes it to the proxy path", async () => {
    const upstreamHeaders = new Headers({ "content-type": "application/json" });
    upstreamHeaders.append(
      "set-cookie",
      "jwt=abc.def; Path=/; Domain=ekklesia.example; HttpOnly; Secure; SameSite=Lax; Max-Age=3600",
    );
    upstreamHeaders.append("set-cookie", "mesh_wallet_session=hijack; Path=/");
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: upstreamHeaders }));

    const res = await call({ method: "PUT", query: { path: ["v0", "session"] }, body: {} });

    expect(res.headers["set-cookie"]).toEqual([
      "ekklesia_jwt=abc.def; Secure; SameSite=Lax; Max-Age=3600; HttpOnly; Path=/api/ekklesia",
      // An upstream cookie named like ours can no longer overwrite it.
      "ekklesia_mesh_wallet_session=hijack; HttpOnly; Path=/api/ekklesia",
    ]);
  });

  it("caps how many cookies upstream can set, so it cannot evict ours", async () => {
    const upstreamHeaders = new Headers();
    for (let i = 0; i < 50; i++) upstreamHeaders.append("set-cookie", `c${i}=x`);
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: upstreamHeaders }));

    const res = await call({ query: { path: ["v1", "ballots"] } });
    expect(res.headers["set-cookie"]).toHaveLength(5);
  });

  it("round-trips: a cookie Ekklesia sets comes back to Ekklesia under its own name", async () => {
    const upstreamHeaders = new Headers();
    upstreamHeaders.append(
      "set-cookie",
      "jwt=tok; Expires=Wed, 28 Oct 2026 10:00:00 GMT; Path=/; SameSite=None; Secure",
    );
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200, headers: upstreamHeaders }));
    const login = await call({ method: "PUT", query: { path: ["v0", "session"] }, body: {} });

    const [stored] = login.headers["set-cookie"] as string[];
    // The comma inside Expires survives the rewrite.
    expect(stored).toBe(
      "ekklesia_jwt=tok; Expires=Wed, 28 Oct 2026 10:00:00 GMT; SameSite=None; Secure; HttpOnly; Path=/api/ekklesia",
    );

    // What the browser would send back on the next proxied request.
    const browserCookie = `mesh_wallet_session=ours; ${stored!.split(";")[0]}`;
    await call({ query: { path: ["v1", "ballots"] }, headers: { cookie: browserCookie } });
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Cookie).toBe("jwt=tok");
  });
});

describe("Ekklesia proxy: requests stay under the configured base path", () => {
  it("forwards a normal path and query string", async () => {
    await call({ query: { path: ["v1", "ballots", "6a15"], page: "2", tag: ["a", "b"] } });
    expect(upstreamRequest().url).toBe(`${BASE}/v1/ballots/6a15?page=2&tag=a&tag=b`);
  });

  it.each([
    [[".."]],
    [["v1", "..", "..", "admin"]],
    [["."]],
    [["v1", ""]],
    [["v1", "../../admin"]],
    [["v1", "..\\admin"]],
    [[]],
  ])("rejects %j with 400 and never calls upstream", async (path) => {
    const res = await call({ query: { path } });
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("encodes segments rather than letting them restructure the URL", () => {
    const url = buildUpstreamUrl(BASE, ["v1", "a?b#c", "%2e%2e"], new URLSearchParams());
    expect(url?.toString()).toBe(`${BASE}/v1/a%3Fb%23c/%252e%252e`);
  });

  it("tolerates a trailing slash on the configured base", () => {
    const url = buildUpstreamUrl(`${BASE}/`, ["v1", "ballots"], new URLSearchParams());
    expect(url?.toString()).toBe(`${BASE}/v1/ballots`);
  });
});

describe("cookie helpers", () => {
  it("ignores malformed and bare-prefix cookie pairs", () => {
    expect(upstreamCookieHeader("ekklesia_=x; garbage; =y; ekklesia_a=1=2")).toBe("a=1=2");
    expect(upstreamCookieHeader(undefined)).toBeNull();
    expect(upstreamCookieHeader("")).toBeNull();
  });

  it("drops a Set-Cookie with no name", () => {
    expect(rewriteSetCookie("=value; Path=/")).toBeNull();
    expect(rewriteSetCookie("novalue")).toBeNull();
  });
});
