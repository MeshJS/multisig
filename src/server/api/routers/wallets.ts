import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const walletRouter = createTRPCRouter({
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
