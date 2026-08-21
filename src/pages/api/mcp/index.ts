import { createMcpHandler } from "@modelcontextprotocol/server";
import type { NextApiRequest, NextApiResponse } from "next";

import { addCorsCacheBustingHeaders } from "@/lib/cors";
import { resolveMcpCaller, type McpCaller } from "@/lib/mcp/auth";
import { toWebRequest, writeWebResponse } from "@/lib/mcp/bridge";
import { createMcpServer } from "@/lib/mcp/server";
import { MCP_SCOPES, formatMcpScopes } from "@/lib/mcp/scopes";
import { protectedResourceMetadataUrl } from "@/lib/oauth/config";
import { getClientIP } from "@/lib/security/rateLimit";
import {
  applyAddressRateLimit,
  applyBotRateLimit,
  applyStrictRateLimit,
  enforceBodySize,
} from "@/lib/security/requestGuards";

/**
 * POST /api/mcp — Model Context Protocol endpoint (stateless).
 *
 * One HTTP POST is one complete MCP exchange. There is no session store, no SSE
 * stream and no resumability, so GET and DELETE (the 2025-era session verbs)
 * answer 405. The SDK serves both the modern 2026-07-28 envelope protocol and
 * the legacy 2025 `initialize` handshake from the same tool registry.
 *
 * The tool surface is read-only plus ballot drafts — see `src/lib/mcp/tools.ts`.
 */

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

const MAX_BODY_BYTES = 256 * 1024;

function jsonRpcError(
  res: NextApiResponse,
  httpStatus: number,
  code: number,
  message: string,
) {
  return res
    .status(httpStatus)
    .json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  // MCP clients are server-side and send no Origin. A present Origin means a
  // browser is driving this, which is a DNS-rebinding vector against a locally
  // running server. Rejected here rather than via `cors()`, which throws on a
  // disallowed origin and would surface as a 500.
  if (req.headers.origin) {
    return jsonRpcError(res, 403, -32000, "Forbidden origin");
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return jsonRpcError(res, 405, -32000, "Method Not Allowed");
  }

  if (!applyStrictRateLimit(req, res, { keySuffix: "mcp", maxRequests: 60 })) {
    return;
  }
  if (!enforceBodySize(req, res, MAX_BODY_BYTES)) {
    return;
  }

  let caller: McpCaller | null;
  try {
    caller = await resolveMcpCaller(req);
  } catch (error) {
    console.error("[api/mcp] caller resolution failed:", error);
    return jsonRpcError(res, 500, -32603, "Internal server error");
  }

  if (!caller) {
    return unauthorized(req, res);
  }

  // Charge a per-principal budget once per HTTP exchange — one POST is at most
  // one tool call, so this is the real ceiling. Both identity kinds must be
  // metered: the IP limit above is keyed on a spoofable x-forwarded-for and is
  // shared across every caller behind one address, so it is not a per-principal
  // ceiling for anyone.
  const metered = caller.botId
    ? applyBotRateLimit(req, res, caller.botId)
    : applyAddressRateLimit(req, res, caller.subject);
  if (!metered) {
    return;
  }

  const clientIp = getClientIP(req) ?? "unknown";

  try {
    // Fresh handler per request. `createMcpHandler` builds a fresh McpServer and
    // a fresh single-use transport from the factory on every call.
    const mcp = createMcpHandler(() => createMcpServer(caller, clientIp), {
      onerror: (error) => {
        // Without this, a malformed tool schema surfaces only as a bare 500.
        console.error("[api/mcp] protocol error:", error);
      },
    });

    const response = await mcp.fetch(toWebRequest(req, req.body), {
      parsedBody: req.body,
    });
    await writeWebResponse(res, response);
  } catch (error) {
    console.error("[api/mcp] request failed:", error);
    if (!res.headersSent) {
      jsonRpcError(res, 500, -32603, "Internal server error");
    }
  }
}

/**
 * Scopes advertised in the 401 challenge — what a client asks for by default.
 *
 * This is load-bearing, not cosmetic. Claude Code (and clients following the
 * same rule) request exactly the `scope` from the challenge rather than the
 * full `scopes_supported` catalogue in the metadata document, so anything
 * omitted here is unreachable in practice: the tools exist, but no grant ever
 * covers them.
 *
 * Every grantable scope is advertised, `ballots:write` included. Holding it
 * back made the two ballot tools unreachable: no client asks for a scope the
 * challenge does not name, so the grant never covered them however the user
 * connected. Withholding it here was never the user's choice to make — the
 * consent screen is, where each scope is a separate checkbox the human ticks.
 */
const CHALLENGE_SCOPES = MCP_SCOPES;

/**
 * RFC 9728 challenge. `resource_metadata` is what lets an MCP client discover
 * the authorization server and start an OAuth flow unprompted.
 */
function unauthorized(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${protectedResourceMetadataUrl(req)}", scope="${formatMcpScopes(CHALLENGE_SCOPES)}"`,
  );
  return jsonRpcError(res, 401, -32001, "Unauthorized");
}
