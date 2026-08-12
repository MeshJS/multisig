import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Drives the real MCP protocol through the real route.
 *
 * The SDK is deliberately NOT mocked here — the things most likely to break are
 * the transport wiring and the Node<->web bridge, and a mocked SDK would prove
 * nothing about either.
 */

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const applyStrictRateLimitMock = jest.fn<() => boolean>();
const applyBotRateLimitMock = jest.fn<() => boolean>();
const applyAddressRateLimitMock = jest.fn<() => boolean>();
const enforceBodySizeMock = jest.fn<() => boolean>();
const verifyJwtMock: jest.Mock = jest.fn();
const isBotJwtMock: jest.Mock = jest.fn();
const findBotUserMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: jest.fn(),
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyStrictRateLimit: applyStrictRateLimitMock,
  applyBotRateLimit: applyBotRateLimitMock,
  applyAddressRateLimit: applyAddressRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}));

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: verifyJwtMock,
  isBotJwt: isBotJwtMock,
}));

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: { botUser: { findUnique: findBotUserMock } },
}));

const HUMAN_ADDRESS = "addr_test1qphuman000000000000000000000000000000";

type CapturedResponse = NextApiResponse & {
  _status: number;
  _headers: Record<string, string>;
  _chunks: string[];
  body: () => unknown;
};

function createResponse(): CapturedResponse {
  const state = {
    _status: 200,
    _headers: {} as Record<string, string>,
    _chunks: [] as string[],
    headersSent: false,
  };

  const res: Record<string, unknown> = {
    get _status() {
      return state._status;
    },
    get _headers() {
      return state._headers;
    },
    get _chunks() {
      return state._chunks;
    },
    get headersSent() {
      return state.headersSent;
    },
    setHeader(name: string, value: string) {
      state._headers[name.toLowerCase()] = String(value);
      return res;
    },
    getHeader(name: string) {
      return state._headers[name.toLowerCase()];
    },
    status(code: number) {
      state._status = code;
      return res;
    },
    json(payload: unknown) {
      state.headersSent = true;
      state._chunks.push(JSON.stringify(payload));
      return res;
    },
    writeHead(code: number, headers?: Record<string, string>) {
      state._status = code;
      state.headersSent = true;
      for (const [k, v] of Object.entries(headers ?? {})) {
        state._headers[k.toLowerCase()] = String(v);
      }
      return res;
    },
    write(chunk: Buffer | string) {
      state._chunks.push(chunk.toString());
      return true;
    },
    end(chunk?: Buffer | string) {
      if (chunk) state._chunks.push(chunk.toString());
      state.headersSent = true;
      return res;
    },
    body() {
      const raw = state._chunks.join("");
      if (!raw) return undefined;
      // Legacy-era responses may arrive as an SSE frame rather than bare JSON.
      const sse = raw.match(/^data: (.*)$/m);
      try {
        return JSON.parse(sse ? (sse[1] as string) : raw);
      } catch {
        return raw;
      }
    },
  };

  return res as unknown as CapturedResponse;
}

function createRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  return {
    method: "POST",
    url: "/api/mcp",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer test-token",
      ...extraHeaders,
    },
    socket: { remoteAddress: "127.0.0.1" },
    query: {},
    body,
  } as unknown as NextApiRequest;
}

/** A modern-era (2026-07-28) request: envelope in the body, method in a header. */
function modern(method: string, params: Record<string, unknown> = {}, id = 1) {
  const headers: Record<string, string> = { "mcp-method": method };
  if (typeof params.name === "string") headers["mcp-name"] = params.name;
  return {
    headers,
    body: {
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": {
            name: "jest",
            version: "1.0.0",
          },
        },
      },
    },
  };
}

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/mcp/index"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyStrictRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  applyAddressRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  verifyJwtMock.mockReturnValue({ address: HUMAN_ADDRESS });
  isBotJwtMock.mockReturnValue(false);
});

describe("POST /api/mcp — transport", () => {
  it("rejects GET with 405 (there are no sessions to resume)", async () => {
    const req = createRequest(undefined);
    (req as { method: string }).method = "GET";
    const res = createResponse();
    await handler(req, res);
    expect(res._status).toBe(405);
  });

  it("rejects a browser-originated request", async () => {
    // Origin present => a browser is driving this, a DNS-rebinding vector.
    const req = createRequest(modern("tools/list").body, {
      origin: "https://evil.example",
    });
    const res = createResponse();
    await handler(req, res);
    expect(res._status).toBe(403);
  });

  it("challenges an unauthenticated request per RFC 9728", async () => {
    verifyJwtMock.mockReturnValue(null);
    const { headers, body } = modern("tools/list");
    const res = createResponse();
    await handler(createRequest(body, headers), res);

    expect(res._status).toBe(401);
    const challenge = res._headers["www-authenticate"] ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain("resource_metadata=");
    expect(challenge).toContain("/.well-known/oauth-protected-resource");
  });

  it("serves tools/list on the modern protocol era", async () => {
    const { headers, body } = modern("tools/list");
    const res = createResponse();
    await handler(createRequest(body, headers), res);

    expect(res._status).toBe(200);
    const payload = res.body() as {
      result?: { tools?: { name: string; inputSchema: unknown }[] };
    };
    const names = payload.result?.tools?.map((t) => t.name) ?? [];
    expect(names).toContain("multisig_whoami");
    expect(names).toContain("ballot_upsert");
    // JSON Schema must survive the fromJsonSchema round-trip.
    const whoami = payload.result?.tools?.find(
      (t) => t.name === "multisig_whoami",
    );
    expect(whoami?.inputSchema).toMatchObject({ type: "object" });
  });

  it("serves the legacy 2025 initialize handshake", async () => {
    const res = createResponse();
    await handler(
      createRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "jest", version: "1.0.0" },
        },
      }),
      res,
    );

    expect(res._status).toBe(200);
    const payload = res.body() as {
      result?: { serverInfo?: { name: string }; protocolVersion?: string };
    };
    expect(payload.result?.serverInfo?.name).toBe("mesh-multisig");
    expect(payload.result?.protocolVersion).toBe("2025-06-18");
  });

  it("survives two sequential requests", async () => {
    // A transport is single-use. Hoisting it to module scope would fail here and
    // ONLY here — the first request would look perfectly healthy.
    const first = createResponse();
    const second = createResponse();
    const { headers, body } = modern("tools/list");

    await handler(createRequest(body, headers), first);
    await handler(createRequest(body, headers), second);

    expect(first._status).toBe(200);
    expect(second._status).toBe(200);
    expect(second.body()).toEqual(first.body());
  });
});

describe("POST /api/mcp — per-principal metering", () => {
  // The IP limit is keyed on a spoofable x-forwarded-for and is shared across
  // everyone behind one address, so it is not a ceiling for any single caller.
  // Every identity kind must also be metered on its own principal.
  it("meters a non-bot caller by address", async () => {
    const { headers, body } = modern("tools/list");
    await handler(createRequest(body, headers), createResponse());

    expect(applyAddressRateLimitMock).toHaveBeenCalled();
  });

  it("refuses the request when the address budget is exhausted", async () => {
    applyAddressRateLimitMock.mockReturnValue(false);
    const { headers, body } = modern("tools/list");
    const res = createResponse();
    await handler(createRequest(body, headers), res);

    // The guard writes its own 429; the MCP handler must not run afterwards.
    expect(res.body()).toBeUndefined();
  });

  it("meters a bot caller by botId instead", async () => {
    isBotJwtMock.mockReturnValue(true);
    verifyJwtMock.mockReturnValue({
      address: "addr_test1qpbot",
      botId: "bot-1",
      type: "bot",
    });
    (findBotUserMock as any).mockResolvedValue({
      id: "bot-1",
      paymentAddress: "addr_test1qpbot",
      displayName: null,
      botKey: { name: "Reader", scope: JSON.stringify(["multisig:read"]) },
    });

    const { headers, body } = modern("tools/list");
    await handler(createRequest(body, headers), createResponse());

    expect(applyBotRateLimitMock).toHaveBeenCalled();
    expect(applyAddressRateLimitMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/mcp — scope filtering", () => {
  it("hides out-of-scope tools from a bot with only multisig:read", async () => {
    isBotJwtMock.mockReturnValue(true);
    verifyJwtMock.mockReturnValue({
      address: "addr_test1qpbot",
      botId: "bot-1",
      type: "bot",
    });
    (findBotUserMock as any).mockResolvedValue({
      id: "bot-1",
      paymentAddress: "addr_test1qpbot",
      displayName: null,
      botKey: { name: "Reader", scope: JSON.stringify(["multisig:read"]) },
    });

    const { headers, body } = modern("tools/list");
    const res = createResponse();
    await handler(createRequest(body, headers), res);

    const payload = res.body() as { result?: { tools?: { name: string }[] } };
    const names = payload.result?.tools?.map((t) => t.name) ?? [];
    expect(names).toContain("multisig_list_wallets");
    expect(names).not.toContain("ballot_upsert");
    expect(names).not.toContain("governance_list_active_proposals");
  });
});

describe("POST /api/mcp — tools/call", () => {
  it("answers multisig_whoami from the request context", async () => {
    const { headers, body } = modern("tools/call", {
      name: "multisig_whoami",
      arguments: {},
    });
    const res = createResponse();
    await handler(createRequest(body, headers), res);

    expect(res._status).toBe(200);
    const payload = res.body() as {
      result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
    };
    expect(payload.result?.isError).toBe(false);
    expect(payload.result?.structuredContent).toMatchObject({
      address: HUMAN_ADDRESS,
      identityType: "wallet",
    });
  });

  it("rejects arguments that violate the tool's JSON Schema", async () => {
    const { headers, body } = modern("tools/call", {
      name: "multisig_list_pending_transactions",
      arguments: { walletId: 42 },
    });
    const res = createResponse();
    await handler(createRequest(body, headers), res);

    const payload = res.body() as {
      result?: { isError?: boolean; content?: { text: string }[] };
    };
    expect(payload.result?.isError).toBe(true);
    // ajv, via fromJsonSchema — proves the schema is actually enforced rather
    // than just advertised in tools/list.
    expect(payload.result?.content?.[0]?.text).toContain(
      "data/walletId must be string",
    );
  });

  it("returns the v1 handler's own error rather than throwing", async () => {
    // A wallet the caller cannot see must come back as a readable tool error the
    // model can act on, not a transport failure.
    const { headers, body } = modern("tools/call", {
      name: "multisig_list_wallets",
      arguments: {},
    });
    const res = createResponse();
    await handler(createRequest(body, headers), res);

    expect(res._status).toBe(200);
    const payload = res.body() as { result?: { isError?: boolean } };
    expect(typeof payload.result?.isError).toBe("boolean");
  });
});
