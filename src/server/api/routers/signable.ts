import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const signableRouter = createTRPCRouter({
  createSignable: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        payload: z.string(),
        signatures: z.array(z.string()),
        signedAddresses: z.array(z.string()),
        method: z.string(),
        state: z.number(),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.signable.create({
        data: {
          walletId: input.walletId,
          payload: input.payload,
          signatures: input.signatures,
          signedAddresses: input.signedAddresses,
          method: input.method,
          state: input.state,
          description: input.description,
        },
      });
    }),

  updateSignable: publicProcedure
    .input(
      z.object({
        signableId: z.string(),
        signedAddresses: z.array(z.string()),
        rejectedAddresses: z.array(z.string()),
        signatures: z.array(z.string()),
        state: z.number(),
        txHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.signable.update({
        where: {
          id: input.signableId,
        },
        data: {
          signedAddresses: input.signedAddresses,
          rejectedAddresses: input.rejectedAddresses,
          signatures: input.signatures,
          state: input.state,
        },
      });
    }),

  deleteSignable: publicProcedure
    .input(z.object({ signableId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.signable.delete({
        where: {
          id: input.signableId,
        },
      });
    }),

  getAllSignables: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.signable.findMany({
        where: {
          walletId: input.walletId,
          state: 1,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),

  getPendingSignables: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.signable.findMany({
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
