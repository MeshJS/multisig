import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const transactionRouter = createTRPCRouter({
  createTransaction: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        txJson: z.string(),
        signedAddresses: z.array(z.string()),
        txCbor: z.string(),
        state: z.number(),
        description: z.string().optional(),
        txHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction.create({
        data: {
          walletId: input.walletId,
          txJson: input.txJson,
          signedAddresses: input.signedAddresses,
          txCbor: input.txCbor,
          state: input.state,
          description: input.description,
          txHash: input.txHash,
        },
      });
    }),

  updateTransaction: publicProcedure
    .input(
      z.object({
        transactionId: z.string(),
        signedAddresses: z.array(z.string()),
        txCbor: z.string(),
        state: z.number(),
        txHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction.update({
        where: {
          id: input.transactionId,
        },
        data: {
          signedAddresses: input.signedAddresses,
          txCbor: input.txCbor,
          state: input.state,
          txHash: input.txHash,
        },
      });
    }),

  getAllTransactions: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.transaction.findMany({
        where: {
          walletId: input.walletId,
          state: 1,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),

  getPendingTransactions: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.transaction.findMany({
        where: {
          walletId: input.walletId,
          state: 0,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),
});
