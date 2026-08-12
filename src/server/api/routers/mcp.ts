import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { audit } from "@/lib/observability/audit";

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
