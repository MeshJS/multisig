

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const crowdfundRouter = createTRPCRouter({
  createCrowdfund: publicProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        proposerKeyHashR0: z.string(),
        authTokenId: z.string().optional(),
        datum: z.string().optional(),
        address: z.string().optional(),
        paramUtxo: z.string().optional(), // JSON string containing { txHash: string, outputIndex: number }
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.crowdfund.create({ data: input });
    }),

  deleteCrowdfund: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.crowdfund.delete({ where: { id: input.id } });
    }),

  updateCrowdfund: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        authTokenId: z.string().optional(),
        datum: z.string().optional(),
        address: z.string().optional(),
        paramUtxo: z.string().optional(), // JSON string containing { txHash: string, outputIndex: number }
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return ctx.db.crowdfund.update({
        where: { id },
        data,
      });
    }),

  getAllCrowdfunds: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.crowdfund.findMany();
  }),

  getCrowdfundById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.crowdfund.findUnique({ where: { id: input.id } });
    }),

  getCrowdfundByName: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.crowdfund.findFirst({ where: { name: input.name } });
    }),

  getCrowdfundsByProposerKeyHash: publicProcedure
    .input(z.object({ proposerKeyHashR0: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.crowdfund.findMany({
        where: { proposerKeyHashR0: input.proposerKeyHashR0 },
      });
    }),
});