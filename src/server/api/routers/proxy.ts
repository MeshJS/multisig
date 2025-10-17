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
      console.log("getProxiesByUserOrWallet called with:", input);
      
      const orConditions: any[] = [];
      
      if (input.walletId) {
        orConditions.push({ walletId: input.walletId });
      }

      if (input.userAddress) {
        const user = await ctx.db.user.findUnique({
          where: {
            address: input.userAddress,
          },
        });

        if (user) {
          orConditions.push({ userId: user.id });
        }
      }

      if (orConditions.length === 0) {
        console.log("No conditions found, returning empty array");
        return [];
      }

      const result = await ctx.db.proxy.findMany({
        where: {
          isActive: true,
          OR: orConditions,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      
      console.log("Found proxies:", result.length, result);
      return result;
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
});