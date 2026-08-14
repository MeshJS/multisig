import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { db } from "@/server/db";
import { audit } from "@/lib/observability/audit";
import type { McpCaller } from "@/lib/mcp/auth";
import type { V1Result } from "@/lib/mcp/invokeV1";
import { toolsForScopes, type McpToolDef } from "@/lib/mcp/tools";

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
        const input = (args ?? {}) as Record<string, unknown>;
        const startedAt = Date.now();
        let result;
        try {
          result = await tool.run(input, { caller, clientIp });
        } catch (error) {
          void recordToolCall({
            tool,
            caller,
            input,
            clientIp,
            status: 0,
            durationMs: Date.now() - startedAt,
            reason: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
        void recordToolCall({
          tool,
          caller,
          input,
          clientIp,
          status: result.status,
          durationMs: Date.now() - startedAt,
        });
        return toToolResult(result);
      },
    );
  }

  return server;
}

/** Action name for every MCP tool invocation in the audit log. */
export const MCP_TOOL_ACTION = "mcp.tool.called";

/**
 * Record one tool call.
 *
 * Written against the wallet the call touched (`resourceType: "wallet"`), so
 * the per-wallet activity view is an indexed lookup rather than a scan. Fire
 * and forget: `audit` swallows its own failures, and an audit miss must never
 * break a tool call.
 *
 * Only the walletId is taken from the arguments. Tool inputs can carry
 * user-authored prose — ballot rationales, descriptions — which has no place in
 * an audit row.
 */
function recordToolCall(args: {
  tool: McpToolDef;
  caller: McpCaller;
  input: Record<string, unknown>;
  clientIp: string;
  status: number;
  durationMs: number;
  reason?: string;
}) {
  const walletId =
    typeof args.input.walletId === "string" ? args.input.walletId : null;

  return audit(db, {
    actorAddress: args.caller.subject,
    actorType: args.caller.botId ? "bot" : "user",
    action: MCP_TOOL_ACTION,
    resourceType: walletId ? "wallet" : "mcp",
    resourceId: walletId,
    ip: args.clientIp,
    outcome:
      args.status === 0 ? "error" : args.status >= 400 ? "denied" : "success",
    ...(args.reason ? { reason: args.reason.slice(0, 200) } : {}),
    metadata: {
      tool: args.tool.name,
      scope: args.tool.scope,
      // The OAuth client id, or null for a v1 bearer / bot caller.
      client: args.caller.clientName,
      readOnly: args.tool.annotations.readOnlyHint,
      status: args.status,
      durationMs: args.durationMs,
    },
  });
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
