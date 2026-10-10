import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Node <-> web-standard bridge for the MCP route.
 *
 * The MCP v2 SDK (`@modelcontextprotocol/server`) exposes a fetch-shaped handler
 * (`Request` -> `Response`), but the Pages Router hands us `NextApiRequest` /
 * `NextApiResponse`. These two helpers convert in both directions.
 *
 * We deliberately do NOT use `@modelcontextprotocol/node` for this — it exists,
 * but its only job is this conversion and it drags in `hono` + `@hono/node-server`
 * (~3 MB) to do it.
 */

/**
 * Build a web-standard `Request` from an already-drained Next request.
 *
 * Next's body parser has consumed the underlying stream by the time an API route
 * runs, so the body bytes have to be re-serialised from `req.body` rather than
 * piped. That makes the inbound `content-length` wrong, hence the delete.
 */
export function toWebRequest(
  req: NextApiRequest,
  parsedBody: unknown,
): Request {
  const host = req.headers.host ?? "localhost";
  // `x-forwarded-proto` is set by Railway's proxy; fall back to the socket.
  const proto =
    firstHeader(req.headers["x-forwarded-proto"]) ??
    ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const url = new URL(req.url ?? "/", `${proto}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const one of value) headers.append(key, one);
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method ?? "GET";
  const init: RequestInit = { method, headers };

  if (method !== "GET" && method !== "HEAD" && parsedBody !== undefined) {
    headers.delete("content-length");
    init.body =
      typeof parsedBody === "string" ? parsedBody : JSON.stringify(parsedBody);
  }

  return new Request(url, init);
}

/** Pipe a web-standard `Response` back out through the Node response. */
export async function writeWebResponse(
  res: NextApiResponse,
  response: Response,
): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
