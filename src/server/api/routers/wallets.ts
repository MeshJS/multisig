import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const walletRouter = createTRPCRouter({
  getUserWallets: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.wallet.findMany({
        where: {
          signers: {
            has: input.address,
          },
        },
      });
    }),

  getWallet: publicProcedure
    .input(z.object({ address: z.string(), walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.wallet.findUnique({
        where: {
          id: input.walletId,
          signers: {
            has: input.address,
          },
        },
      });
    }),

  createWallet: publicProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string(),
        signers: z.array(z.string()),
        numberOfSigners: z.number(),
        scriptCbor: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.wallet.create({
        data: {
          name: input.name,
          description: input.description,
          signers: input.signers,
          numberOfSigners: input.numberOfSigners,
          scriptCbor: input.scriptCbor,
        },
      });
    }),
});
