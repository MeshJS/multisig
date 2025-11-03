

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
        govDatum: z.string().optional(), // JSON string containing governance data
        govAddress: z.string().optional(), // Governance contract address
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
        govDatum: z.string().optional(), // JSON string containing governance data
        govAddress: z.string().optional(), // Governance contract address
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

  getPublicCrowdfunds: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.crowdfund.findMany({
      where: {
        authTokenId: {
          not: null, // Only return crowdfunds that have been deployed (have authTokenId)
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
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

  // Contribute to a crowdfund: updates datum.current_fundraised_amount
  contributeCrowdfund: publicProcedure
    .input(
      z.object({
        id: z.string(),
        amount: z.number().positive(), // lovelace
        txHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.crowdfund.findUnique({ where: { id: input.id } });
      if (!existing) {
        throw new Error("Crowdfund not found");
      }
      if (!existing.datum) {
        throw new Error("Crowdfund datum missing");
      }
      let datum: any;
      try {
        datum = JSON.parse(existing.datum);
      } catch {
        throw new Error("Invalid crowdfund datum");
      }
      const current = Number(datum.current_fundraised_amount || 0);
      const updated = current + input.amount;
      datum.current_fundraised_amount = updated;

      return ctx.db.crowdfund.update({
        where: { id: input.id },
        data: {
          datum: JSON.stringify(datum),
          // optionally we could store latest txHash in a field if present in schema
        },
      });
    }),

  // Withdraw from a crowdfund: decreases datum.current_fundraised_amount (not below 0)
  withdrawCrowdfund: publicProcedure
    .input(
      z.object({
        id: z.string(),
        amount: z.number().positive(), // lovelace
        txHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.crowdfund.findUnique({ where: { id: input.id } });
      if (!existing) {
        throw new Error("Crowdfund not found");
      }
      if (!existing.datum) {
        throw new Error("Crowdfund datum missing");
      }
      let datum: any;
      try {
        datum = JSON.parse(existing.datum);
      } catch {
        throw new Error("Invalid crowdfund datum");
      }
      const current = Number(datum.current_fundraised_amount || 0);
      const updated = Math.max(0, current - input.amount);
      datum.current_fundraised_amount = updated;

      return ctx.db.crowdfund.update({
        where: { id: input.id },
        data: {
          datum: JSON.stringify(datum),
        },
      });
    }),
});