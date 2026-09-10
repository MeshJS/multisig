import type { PrismaClient } from "@prisma/client";

import { mintV1Token, type McpCaller } from "@/lib/mcp/auth";
import { invokeV1 } from "@/lib/mcp/invokeV1";
import { MCP_SCOPES } from "@/lib/mcp/scopes";
import type { ToolContext } from "@/lib/mcp/tools";
import type { ReviewDeps } from "@/lib/tx-review/pipeline";
import type { AuthCtx } from "@/server/api/trpc";
import { getSessionAddresses, requireSessionAddress } from "@/server/api/auth";

/**
 * How the web app enters the tx-review pipeline — the same pipeline the MCP
 * tools use, with the caller derived from the tRPC session instead of a
 * bearer token.
 *
 * `clientName` is a fixed marker rather than null: a draft token carries the
 * client id and `verifyDraftToken` compares it, so a token previewed in the
 * app cannot be confirmed through an MCP connection (whose v1-bearer client
 * id is null) or vice versa. The same human, but two surfaces that each show
 * their own review. It also lands in `txJson.mcp.client`, where "app" reads
 * as "shared pipeline, confirmed in the web app".
 */
export const APP_CLIENT_ID = "app";

export function callerFromSession(ctx: AuthCtx): McpCaller {
  const subject = requireSessionAddress(ctx);
  const addresses = [...new Set([subject, ...getSessionAddresses(ctx)])];
  return {
    subject,
    addresses,
    scopes: [...MCP_SCOPES],
    clientName: APP_CLIENT_ID,
    botId: null,
    expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
  };
}

export function toolContextFromSession(ctx: AuthCtx): ToolContext {
  return { caller: callerFromSession(ctx), clientIp: ctx.ip };
}

/**
 * The pipeline's dependencies outside MCP. Spendable UTxOs come from the v1
 * `freeUtxos` handler run in-process against a synthetic request — exactly
 * what `callV1` does for the tools — so pending-transaction input locking
 * stays defined once, in that handler. The handler module is imported lazily
 * because it pulls Mesh into the module graph.
 */
export function buildReviewDeps(
  db: PrismaClient,
  toolCtx: ToolContext,
  extra: Partial<ReviewDeps> = {},
): ReviewDeps {
  return {
    db,
    fetchFreeUtxos: async (walletId) => {
      const handler = (await import("@/pages/api/v1/freeUtxos")).default;
      return invokeV1({
        handler,
        method: "GET",
        token: mintV1Token(toolCtx.caller, toolCtx.caller.subject),
        clientIp: toolCtx.clientIp,
        query: { walletId, address: toolCtx.caller.subject, fresh: "true" },
      });
    },
    ...extra,
  };
}
