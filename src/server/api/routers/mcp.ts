import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { audit } from "@/lib/observability/audit";
import { assertWalletAccess } from "@/server/api/auth";
import { MCP_SCOPES, isMcpScope } from "@/lib/mcp/scopes";

/** Mirrors MCP_TOOL_ACTION in src/lib/mcp/server.ts. Duplicated rather than
 *  imported: that module pulls the MCP SDK and the whole tool registry, which
 *  has no place in the tRPC bundle. Kept honest by a test. */
const MCP_TOOL_ACTION = "mcp.tool.called";

type ToolCallMetadata = {
  tool?: string;
  client?: string | null;
  scope?: string;
  readOnly?: boolean;
  status?: number;
  durationMs?: number;
};

/**
 * MCP connections — the OAuth grants a user has approved for AI clients.
 *
 * Mirrors the bot-key surface in `bot.ts`: a user can see what they have
 * connected and revoke it. Revocation is the important half — before this,
 * approving a client through the consent screen was a one-way door, since
 * nothing read `OAuthGrant` back.
 */

type SessionAddressContext = {
  primaryWallet?: string | null;
  sessionWallets?: string[];
};

/**
 * Resolve the acting address from the wallet session, refusing anything the
 * session does not actually hold. Same contract as `bot.ts` — a body-supplied
 * address must never be trusted on its own, or one user could revoke another's
 * connections.
 */
function requireSessionAddress(ctx: unknown, requesterAddress: string): string {
  const c = ctx as SessionAddressContext;
  const requested = requesterAddress.trim();
  const sessionWallets = Array.isArray(c.sessionWallets) ? c.sessionWallets : [];

  if (!c.primaryWallet && sessionWallets.length === 0) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Please authorize your active wallet first",
    });
  }
  if (!requested) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing requester address" });
  }
  if (c.primaryWallet !== requested && !sessionWallets.includes(requested)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Address mismatch. Please authorize your currently connected wallet.",
    });
  }
  return requested;
}

export const mcpRouter = createTRPCRouter({
  /** Every AI client this address has approved, newest first. */
  listConnections: protectedProcedure
    .input(z.object({ requesterAddress: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const subjectAddress = requireSessionAddress(ctx, input.requesterAddress);

      const grants = await ctx.db.oAuthGrant.findMany({
        where: { subjectAddress },
        orderBy: { updatedAt: "desc" },
      });
      if (grants.length === 0) return [];

      const clientIds = grants.map((g) => g.clientId);
      const [clients, tokens] = await Promise.all([
        ctx.db.oAuthClient.findMany({ where: { clientId: { in: clientIds } } }),
        ctx.db.oAuthRefreshToken.findMany({
          where: { subjectAddress, clientId: { in: clientIds }, revokedAt: null },
          select: { clientId: true, expiresAt: true },
        }),
      ]);

      const clientById = new Map(clients.map((c) => [c.clientId, c]));
      const now = Date.now();

      return grants.map((grant) => {
        const client = clientById.get(grant.clientId);
        const live = tokens.filter(
          (t) => t.clientId === grant.clientId && t.expiresAt.getTime() > now,
        ).length;
        return {
          clientId: grant.clientId,
          // Self-declared by whoever registered the client, so the UI shows the
          // client id alongside it rather than treating this as an identity.
          clientName: client?.clientName ?? "Unknown client",
          clientUri: client?.clientUri ?? null,
          /** True when the client id is a Client ID Metadata Document URL. */
          isMetadataUrl: client?.isMetadataUrl ?? false,
          scopes: grant.scopes,
          grantedAddresses: grant.grantedAddresses,
          approvedAt: grant.createdAt,
          lastApprovedAt: grant.updatedAt,
          /** Unexpired, unrevoked refresh tokens — i.e. whether it can still reconnect. */
          activeSessions: live,
        };
      });
    }),

  /**
   * Change what a connected client is allowed to do.
   *
   * The grant is what the MCP endpoint reads on every request (see
   * `resolveMcpCaller`), so a change here takes effect on the client's next
   * call — not whenever its hour-long access token happens to expire.
   */
  updateConnectionScopes: protectedProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        requesterAddress: z.string().min(1),
        scopes: z.array(z.enum(MCP_SCOPES)),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subjectAddress = requireSessionAddress(ctx, input.requesterAddress);

      const grant = await ctx.db.oAuthGrant.findUnique({
        where: {
          subjectAddress_clientId: { subjectAddress, clientId: input.clientId },
        },
      });
      if (!grant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
      }

      // Removing every permission leaves a connection that authenticates but can
      // do nothing, which reads as broken. Revoking is the honest action.
      if (input.scopes.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Leave at least one permission, or revoke the connection instead.",
        });
      }

      const scopes = MCP_SCOPES.filter((s) => input.scopes.includes(s));
      const removed = grant.scopes.filter((s) => !scopes.includes(s as never));

      await ctx.db.$transaction([
        ctx.db.oAuthGrant.update({
          where: { id: grant.id },
          data: { scopes },
        }),
        // Keep refresh tokens in step, so a refresh cannot re-widen the grant.
        ctx.db.oAuthRefreshToken.updateMany({
          where: { subjectAddress, clientId: input.clientId, revokedAt: null },
          data: { scopes },
        }),
      ]);

      void audit(ctx.db, {
        actorAddress: subjectAddress,
        actorType: "user",
        action: "mcp.connection.scopes_updated",
        resourceType: "oauth_grant",
        resourceId: input.clientId,
        outcome: "success",
        metadata: { scopes, removed },
      });

      return { ok: true, scopes };
    }),

  /**
   * Which AI clients have touched this wallet, and how much.
   *
   * Reads the audit trail rather than the grants: a grant says what a client
   * *may* do, this says what it actually did to this wallet.
   */
  walletClients: protectedProcedure
    .input(z.object({ walletId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);

      const rows = await ctx.db.auditLog.findMany({
        where: {
          action: MCP_TOOL_ACTION,
          resourceType: "wallet",
          resourceId: input.walletId,
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      });

      const byClient = new Map<
        string,
        { client: string; actorAddress: string | null; calls: number; failures: number; lastUsedAt: Date; tools: Set<string> }
      >();

      for (const row of rows) {
        const meta = (row.metadata ?? {}) as ToolCallMetadata;
        const key = meta.client ?? row.actorAddress ?? "unknown";
        const existing = byClient.get(key);
        if (existing) {
          existing.calls += 1;
          if (row.outcome !== "success") existing.failures += 1;
          if (meta.tool) existing.tools.add(meta.tool);
        } else {
          byClient.set(key, {
            client: key,
            actorAddress: row.actorAddress,
            calls: 1,
            failures: row.outcome === "success" ? 0 : 1,
            lastUsedAt: row.createdAt,
            tools: new Set(meta.tool ? [meta.tool] : []),
          });
        }
      }

      return [...byClient.values()]
        .map((c) => ({ ...c, tools: [...c.tools].sort() }))
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime());
    }),

  /** The individual tool calls behind those totals. */
  walletToolUsage: protectedProcedure
    .input(
      z.object({
        walletId: z.string().min(1),
        client: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);

      const rows = await ctx.db.auditLog.findMany({
        where: {
          action: MCP_TOOL_ACTION,
          resourceType: "wallet",
          resourceId: input.walletId,
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      });

      return rows
        .map((row) => {
          const meta = (row.metadata ?? {}) as ToolCallMetadata;
          return {
            id: row.id,
            at: row.createdAt,
            tool: meta.tool ?? "unknown",
            client: meta.client ?? null,
            actorAddress: row.actorAddress,
            scope: meta.scope ?? null,
            readOnly: meta.readOnly ?? true,
            outcome: row.outcome,
            status: meta.status ?? null,
            durationMs: meta.durationMs ?? null,
            reason: row.reason,
          };
        })
        .filter((r) => !input.client || r.client === input.client)
        .slice(0, input.limit);
    }),

  /**
   * Revoke a connection: drop the consent record and kill every refresh token
   * issued under it.
   *
   * Outstanding access tokens are self-contained JWTs and stay valid until they
   * expire (one hour), which is the normal trade-off for stateless verification.
   * Removing the refresh tokens is what stops the client renewing, and dropping
   * the grant means a fresh authorization needs consent again.
   */
  revokeConnection: protectedProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        requesterAddress: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subjectAddress = requireSessionAddress(ctx, input.requesterAddress);

      const grant = await ctx.db.oAuthGrant.findUnique({
        where: {
          subjectAddress_clientId: { subjectAddress, clientId: input.clientId },
        },
      });
      if (!grant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
      }

      const [, revoked] = await ctx.db.$transaction([
        ctx.db.oAuthGrant.delete({ where: { id: grant.id } }),
        ctx.db.oAuthRefreshToken.updateMany({
          where: { subjectAddress, clientId: input.clientId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);

      void audit(ctx.db, {
        actorAddress: subjectAddress,
        actorType: "user",
        action: "mcp.connection.revoked",
        resourceType: "oauth_grant",
        resourceId: input.clientId,
        outcome: "success",
        metadata: { refreshTokensRevoked: revoked.count, scopes: grant.scopes },
      });

      return { ok: true, refreshTokensRevoked: revoked.count };
    }),
});
