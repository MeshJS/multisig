

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

const govExtensionInput = z.object({
  gov_action_period: z.number().optional(),
  delegate_pool_id: z.string().optional(),
  gov_action: z.any().optional(), // JSON object
  stake_register_deposit: z.number().optional(),
  drep_register_deposit: z.number().optional(),
  gov_deposit: z.number().optional(),
  govActionMetadataUrl: z.string().optional(),
  govActionMetadataHash: z.string().optional(),
  drepMetadataUrl: z.string().optional(),
  drepMetadataHash: z.string().optional(),
  govAddress: z.string().optional(),
});

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
        govDatum: z.string().optional(), // Deprecated: kept for backward compatibility
        govAddress: z.string().optional(), // Deprecated: kept for backward compatibility
        govExtension: govExtensionInput.optional(), // New: structured governance extension data
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { govExtension, ...crowdfundData } = input;
      
      // Create crowdfund
      const crowdfund = await ctx.db.crowdfund.create({ 
        data: crowdfundData,
        include: { govExtension: true },
      });

      // Create gov extension if provided
      if (govExtension) {
        await ctx.db.crowdfundGovExtension.create({
          data: {
            crowdfundId: crowdfund.id,
            ...govExtension,
          },
        });
      }

      // Return with gov extension
      return ctx.db.crowdfund.findUnique({
        where: { id: crowdfund.id },
        include: { govExtension: true },
      });
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
        govDatum: z.string().optional(), // Deprecated: kept for backward compatibility
        govAddress: z.string().optional(), // Deprecated: kept for backward compatibility
        govExtension: govExtensionInput.optional(), // New: structured governance extension data
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, govExtension, ...crowdfundData } = input;
      
      // Update crowdfund
      await ctx.db.crowdfund.update({
        where: { id },
        data: crowdfundData,
      });

      // Update or create gov extension if provided
      if (govExtension !== undefined) {
        const existing = await ctx.db.crowdfundGovExtension.findUnique({
          where: { crowdfundId: id },
        });

        if (existing) {
          await ctx.db.crowdfundGovExtension.update({
            where: { crowdfundId: id },
            data: govExtension,
          });
        } else if (govExtension !== null) {
          await ctx.db.crowdfundGovExtension.create({
            data: {
              crowdfundId: id,
              ...govExtension,
            },
          });
        }
      }

      // Return with gov extension
      return ctx.db.crowdfund.findUnique({
        where: { id },
        include: { govExtension: true },
      });
    }),

  getAllCrowdfunds: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.crowdfund.findMany({
      include: { govExtension: true },
    });
  }),

  getPublicCrowdfunds: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.crowdfund.findMany({
      where: {
        authTokenId: {
          not: null, // Only return crowdfunds that have been deployed (have authTokenId)
        },
      },
      include: { govExtension: true },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }),

  getCrowdfundById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.crowdfund.findUnique({ 
        where: { id: input.id },
        include: { govExtension: true },
      });
    }),

  getCrowdfundByName: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.crowdfund.findFirst({ 
        where: { name: input.name },
        include: { govExtension: true },
      });
    }),

  getCrowdfundsByProposerKeyHash: publicProcedure
    .input(z.object({ proposerKeyHashR0: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.crowdfund.findMany({
        where: { proposerKeyHashR0: input.proposerKeyHashR0 },
        include: { govExtension: true },
      });
    }),

  getCrowdfundWithGovExtension: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.crowdfund.findUnique({
        where: { id: input.id },
        include: { govExtension: true },
      });
    }),

  updateGovExtension: publicProcedure
    .input(
      z.object({
        crowdfundId: z.string(),
        govExtension: govExtensionInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.crowdfundGovExtension.findUnique({
        where: { crowdfundId: input.crowdfundId },
      });

      if (existing) {
        return ctx.db.crowdfundGovExtension.update({
          where: { crowdfundId: input.crowdfundId },
          data: input.govExtension,
        });
      } else {
        return ctx.db.crowdfundGovExtension.create({
          data: {
            crowdfundId: input.crowdfundId,
            ...input.govExtension,
          },
        });
      }
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