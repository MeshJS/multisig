import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

/**
 * Runs an existing `/api/v1/*` handler in-process against a synthetic
 * request/response pair and captures what it wrote.
 *
 * The MCP tools deliberately do not reimplement any business logic, and do not
 * loop back over HTTP either. Every authorization check, validation branch and
 * error code stays defined exactly once, in the v1 handler. This is the same
 * shape the repo's own handler tests already use
 * (`src/__tests__/apiTestUtils.ts` -> `createMockResponse`).
 */

/** Hard ceiling on a single v1 call, comfortably under the 60s platform cap. */
const HANDLER_TIMEOUT_MS = 25_000;

export type V1Result = {
  status: number;
  body: unknown;
};

export type InvokeV1Args = {
  handler: NextApiHandler;
  method: "GET" | "POST";
  /** Internal short-lived JWT minted for the caller; see src/lib/mcp/auth.ts. */
  token: string;
  /** Real client IP, so the inner rate limiter is not fed a constant. */
  clientIp: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

export async function invokeV1(args: InvokeV1Args): Promise<V1Result> {
  const { handler, method, token, clientIp, query = {}, body } = args;

  // Drop undefined query entries — v1 handlers type-check with `typeof x !== "string"`
  // and an explicit `undefined` would read as "provided but wrong type".
  const cleanQuery: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) cleanQuery[key] = value;
  }

  const req = {
    method,
    url: "/api/mcp",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-forwarded-for": clientIp,
    },
    cookies: {},
    query: cleanQuery,
    body: body ?? {},
    socket: { remoteAddress: clientIp },
  } as unknown as NextApiRequest;

  const capture = createCapturingResponse();

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`v1 handler timed out after ${HANDLER_TIMEOUT_MS}ms`)),
      HANDLER_TIMEOUT_MS,
    ).unref?.();
  });

  await Promise.race([
    Promise.resolve(handler(req, capture.res)).then(() => undefined),
    timeout,
  ]);

  return {
    status: capture.state.status ?? 200,
    body: capture.state.body,
  };
}

type CaptureState = {
  status: number | undefined;
  body: unknown;
  settled: boolean;
};

/**
 * A `NextApiResponse` that records instead of writing. Only the surface the v1
 * handlers actually touch is implemented; `setHeader` is accepted and discarded
 * so nothing a handler sets (notably `Set-Cookie`) can leak into a tool result.
 */
function createCapturingResponse(): {
  res: NextApiResponse;
  state: CaptureState;
} {
  const state: CaptureState = {
    status: undefined,
    body: undefined,
    settled: false,
  };

  const settle = (payload: unknown) => {
    // First write wins — mirrors a real ServerResponse, where a second send
    // would throw ERR_HTTP_HEADERS_SENT rather than overwrite.
    if (state.settled) return;
    state.settled = true;
    state.body = payload;
  };

  const res = {
    statusCode: 200,
    status(code: number) {
      state.status = code;
      this.statusCode = code;
      return this as unknown as NextApiResponse;
    },
    json(payload: unknown) {
      settle(payload);
      return this as unknown as NextApiResponse;
    },
    send(payload: unknown) {
      settle(payload);
      return this as unknown as NextApiResponse;
    },
    end(payload?: unknown) {
      settle(payload);
      return this as unknown as NextApiResponse;
    },
    setHeader() {
      return this as unknown as NextApiResponse;
    },
    getHeader() {
      return undefined;
    },
    removeHeader() {
      /* no-op */
    },
    writeHead(code: number) {
      state.status = code;
      return this as unknown as NextApiResponse;
    },
  };

  return { res: res as unknown as NextApiResponse, state };
}
