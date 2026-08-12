import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import type { McpCaller } from "@/lib/mcp/auth";
import type { V1Result } from "@/lib/mcp/invokeV1";
import { toolsForScopes } from "@/lib/mcp/tools";

export const MCP_SERVER_NAME = "mesh-multisig";
export const MCP_SERVER_VERSION = "0.1.0";

/**
 * Build the MCP server for a single request.
 *
 * This is called once per HTTP request by `createMcpHandler` — that is what
 * stateless means here. Nothing may be hoisted to module scope: a transport is
 * single-use, and a shared instance would fail on the *second* request rather
 * than the first, which is exactly the kind of bug a one-shot smoke test misses.
 */
export function createMcpServer(caller: McpCaller, clientIp: string): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  // Register only what this caller's scopes actually permit, so `tools/list`
  // never advertises a tool that would come back 403. The model does not see
  // capabilities it cannot use.
  for (const tool of toolsForScopes(caller.scopes)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema),
        annotations: tool.annotations,
      },
      async (args: unknown) => {
        const result = await tool.run(
          (args ?? {}) as Record<string, unknown>,
          { caller, clientIp },
        );
        return toToolResult(result);
      },
    );
  }

  return server;
}

/**
 * Map a v1 handler result onto an MCP tool result.
 *
 * A non-2xx becomes `isError: true` with the handler's own error body rather
 * than a thrown exception, so the model can read what went wrong and correct
 * itself (wrong walletId, missing scope) instead of just seeing a failure.
 */
export function toToolResult(result: V1Result) {
  const isError = result.status >= 400;
  const body = result.body;

  const text =
    typeof body === "string" ? body : JSON.stringify(body ?? null, null, 2);

  // `structuredContent` must be a JSON object. Arrays are already wrapped by the
  // registry; anything else (a bare string body) travels as text only.
  const structured =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;

  return {
    content: [{ type: "text" as const, text }],
    ...(structured ? { structuredContent: structured } : {}),
    isError,
  };
}
