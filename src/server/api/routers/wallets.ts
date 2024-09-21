import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const walletRouter = createTRPCRouter({
  getUserWallets: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.wallet.findMany({
        where: {
          signersAddresses: {
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
          signersAddresses: {
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
        signersAddresses: z.array(z.string()),
        signersDescriptions: z.array(z.string()),
        numRequiredSigners: z.number(),
        scriptCbor: z.string(),
        stakeCredentialHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.wallet.create({
        data: {
          name: input.name,
          description: input.description,
          signersAddresses: input.signersAddresses,
          signersDescriptions: input.signersDescriptions,
          numRequiredSigners: input.numRequiredSigners,
          scriptCbor: input.scriptCbor,
          stakeCredentialHash: input.stakeCredentialHash,
        },
      });
    }),
});
