import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const proxyRouter = createTRPCRouter({
  createProxy: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        proxyAddress: z.string(),
        authTokenId: z.string(),
        paramUtxo: z.string(),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.proxy.create({
        data: {
          walletId: input.walletId,
          proxyAddress: input.proxyAddress,
          authTokenId: input.authTokenId,
          paramUtxo: input.paramUtxo,
          description: input.description,
        },
      });
    }),

  getProxyByWalletId: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.proxy.findUnique({
        where: {
          walletId: input.walletId,
        },
      });
    }),

  updateProxy: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        proxyAddress: z.string().optional(),
        authTokenId: z.string().optional(),
        paramUtxo: z.string().optional(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { walletId, ...updateData } = input;
      return ctx.db.proxy.update({
        where: {
          walletId: walletId,
        },
        data: updateData,
      });
    }),

  deleteProxy: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.proxy.delete({
        where: {
          walletId: input.walletId,
        },
      });
    }),
});

