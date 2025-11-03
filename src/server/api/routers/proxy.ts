import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const proxyRouter = createTRPCRouter({
  getUserByAddress: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.user.findUnique({
        where: {
          address: input.address,
        },
      });
    }),
  createProxy: publicProcedure
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

  getProxiesByWallet: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
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

  getProxiesByUser: publicProcedure
    .input(z.object({ userAddress: z.string() }))
    .query(async ({ ctx, input }) => {
      // First find the user by address
      const user = await ctx.db.user.findUnique({
        where: {
          address: input.userAddress,
        },
      });

      if (!user) {
        return [];
      }

      return ctx.db.proxy.findMany({
        where: {
          userId: user.id,
          isActive: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),

  getProxiesByUserOrWallet: publicProcedure
    .input(z.object({ 
      walletId: z.string().optional(),
      userAddress: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Prefer fetching by walletId when available
      if (input.walletId) {
        return ctx.db.proxy.findMany({
          where: {
            walletId: input.walletId,
            isActive: true,
          },
          orderBy: { createdAt: "desc" },
        });
      }

      // Fallback: fetch by user address if provided
      if (input.userAddress) {
        const user = await ctx.db.user.findUnique({
          where: { address: input.userAddress },
        });
        if (!user) return [];
        return ctx.db.proxy.findMany({
          where: {
            userId: user.id,
            isActive: true,
          },
          orderBy: { createdAt: "desc" },
        });
      }

      // No criteria provided
      return [];
    }),

  getProxyById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.proxy.findUnique({
        where: {
          id: input.id,
        },
      });
    }),

  updateProxy: publicProcedure
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

  deleteProxy: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.proxy.delete({
        where: {
          id: input.id,
        },
      });
    }),

  deactivateProxy: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.proxy.update({
        where: {
          id: input.id,
        },
        data: {
          isActive: false,
        },
      });
    }),

  transferProxies: publicProcedure
    .input(z.object({ 
      fromWalletId: z.string(),
      toWalletId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
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