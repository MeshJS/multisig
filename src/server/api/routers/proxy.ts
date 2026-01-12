import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

const requireSessionAddress = (ctx: any) => {
  const address = ctx.session?.user?.id ?? ctx.sessionAddress;
  if (!address) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return address;
};

const assertWalletAccess = async (ctx: any, walletId: string, requester: string) => {
  const wallet = await ctx.db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }
  const isSigner =
    Array.isArray(wallet.signersAddresses) && wallet.signersAddresses.includes(requester);
  const isOwner = wallet.ownerAddress === requester || wallet.ownerAddress === "all";
  if (!isSigner && !isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this wallet" });
  }
  return wallet;
};

const getUserIdForAddress = async (ctx: any, address: string) => {
  const user = await ctx.db.user.findUnique({ where: { address } });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  return user.id;
};

export const proxyRouter = createTRPCRouter({
  getUserByAddress: protectedProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      if (sessionAddress !== input.address) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
      return ctx.db.user.findUnique({
        where: {
          address: input.address,
        },
      });
    }),
  createProxy: protectedProcedure
    .input(
      z.object({
        walletId: z.string().optional(),
        userId: z.string().optional(),
        proxyAddress: z.string(),
        authTokenId: z.string(),
        paramUtxo: z.string(),
        description: z.string().optional(),
      }).refine(
        (data) => data.walletId || data.userId,
        {
          message: "Either walletId or userId must be provided",
        }
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      if (input.walletId) {
        await assertWalletAccess(ctx, input.walletId, sessionAddress);
      }
      if (input.userId) {
        const sessionUserId = await getUserIdForAddress(ctx, sessionAddress);
        if (sessionUserId !== input.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "User mismatch" });
        }
      }
      return ctx.db.proxy.create({
        data: {
          walletId: input.walletId,
          userId: input.userId,
          proxyAddress: input.proxyAddress,
          authTokenId: input.authTokenId,
          paramUtxo: input.paramUtxo,
          description: input.description,
        },
      });
    }),

  // Read-only queries require authenticated session whose address is a signer/owner
  getProxiesByWallet: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      return ctx.db.proxy.findMany({
        where: {
          walletId: input.walletId,
          isActive: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),

  getProxiesByUser: protectedProcedure
    .input(z.object({ userAddress: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : [requireSessionAddress(ctx)];
      if (!addresses.includes(input.userAddress)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
      // Optimized: Use a single query with raw SQL to avoid N+1
      // This performs a JOIN in a single database round trip
      const proxies = await ctx.db.$queryRaw<Array<{
        id: string;
        walletId: string | null;
        proxyAddress: string;
        authTokenId: string;
        paramUtxo: string;
        description: string | null;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        userId: string | null;
      }>>`
        SELECT p.*
        FROM "Proxy" p
        INNER JOIN "User" u ON p."userId" = u.id
        WHERE u.address = ${input.userAddress}
          AND p."isActive" = true
        ORDER BY p."createdAt" DESC
      `;

      return proxies;
    }),

  getProxiesByUserOrWallet: protectedProcedure
    .input(z.object({ 
      walletId: z.string().optional(),
      userAddress: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : [requireSessionAddress(ctx)];
      // Prefer fetching by walletId when available (already optimized with index)
      if (input.walletId) {
        // Any authorized wallet that is a signer/owner grants access
        let authorized = false;
        for (const addr of addresses) {
          try {
            await assertWalletAccess(ctx, input.walletId, addr);
            authorized = true;
            break;
          } catch {
            // try next address
          }
        }
        if (!authorized) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this wallet" });
        }
        return ctx.db.proxy.findMany({
          where: {
            walletId: input.walletId,
            isActive: true,
          },
          orderBy: { createdAt: "desc" },
        });
      }

      // Fallback: fetch by user address if provided
      // Optimized: Use a single query with raw SQL to avoid N+1
      if (input.userAddress) {
        if (!addresses.includes(input.userAddress)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
        }
        const proxies = await ctx.db.$queryRaw<Array<{
          id: string;
          walletId: string | null;
          proxyAddress: string;
          authTokenId: string;
          paramUtxo: string;
          description: string | null;
          isActive: boolean;
          createdAt: Date;
          updatedAt: Date;
          userId: string | null;
        }>>`
          SELECT p.*
          FROM "Proxy" p
          INNER JOIN "User" u ON p."userId" = u.id
          WHERE u.address = ${input.userAddress}
            AND p."isActive" = true
          ORDER BY p."createdAt" DESC
        `;

        return proxies;
      }

      // No criteria provided
      return [];
    }),

  getProxyById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.proxy.findUnique({
        where: {
          id: input.id,
        },
      });
    }),

  updateProxy: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
        walletId: z.string().optional(),
        userId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const proxy = await ctx.db.proxy.findUnique({ where: { id: input.id } });
      if (!proxy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proxy not found" });
      }
      if (proxy.walletId) {
        await assertWalletAccess(ctx, proxy.walletId, sessionAddress);
      }
      if (proxy.userId) {
        const sessionUserId = await getUserIdForAddress(ctx, sessionAddress);
        if (sessionUserId !== proxy.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "User mismatch" });
        }
      }
      return ctx.db.proxy.update({
        where: {
          id: input.id,
        },
        data: {
          description: input.description,
          isActive: input.isActive,
          walletId: input.walletId,
          userId: input.userId,
        },
      });
    }),

  deleteProxy: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const proxy = await ctx.db.proxy.findUnique({ where: { id: input.id } });
      if (!proxy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proxy not found" });
      }
      if (proxy.walletId) {
        await assertWalletAccess(ctx, proxy.walletId, sessionAddress);
      }
      if (proxy.userId) {
        const sessionUserId = await getUserIdForAddress(ctx, sessionAddress);
        if (sessionUserId !== proxy.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "User mismatch" });
        }
      }
      return ctx.db.proxy.delete({
        where: {
          id: input.id,
        },
      });
    }),

  deactivateProxy: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const proxy = await ctx.db.proxy.findUnique({ where: { id: input.id } });
      if (!proxy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proxy not found" });
      }
      if (proxy.walletId) {
        await assertWalletAccess(ctx, proxy.walletId, sessionAddress);
      }
      if (proxy.userId) {
        const sessionUserId = await getUserIdForAddress(ctx, sessionAddress);
        if (sessionUserId !== proxy.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "User mismatch" });
        }
      }
      return ctx.db.proxy.update({
        where: {
          id: input.id,
        },
        data: {
          isActive: false,
        },
      });
    }),

  transferProxies: protectedProcedure
    .input(z.object({ 
      fromWalletId: z.string(),
      toWalletId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.fromWalletId, sessionAddress);
      await assertWalletAccess(ctx, input.toWalletId, sessionAddress);
      // Find all active proxies for the source wallet
      const proxies = await ctx.db.proxy.findMany({
        where: {
          walletId: input.fromWalletId,
          isActive: true,
        },
      });

      if (proxies.length === 0) {
        return { transferred: 0, message: "No proxies found to transfer" };
      }

      // Update all proxies to point to the new wallet
      const updatePromises = proxies.map(proxy =>
        ctx.db.proxy.update({
          where: { id: proxy.id },
          data: { walletId: input.toWalletId },
        })
      );

      await Promise.all(updatePromises);

      return { 
        transferred: proxies.length, 
        message: `Successfully transferred ${proxies.length} proxy${proxies.length !== 1 ? 'ies' : ''}` 
      };
    }),
});