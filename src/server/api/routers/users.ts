import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const userRouter = createTRPCRouter({
  getUserByAddress: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.user.findUnique({
        where: {
          address: input.address,
        },
      });
    }),

  createUser: publicProcedure
    .input(
      z.object({
        address: z.string(),
        stakeAddress: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.create({
        data: {
          address: input.address,
          stakeAddress: input.stakeAddress,
        },
      });
    }),
});
