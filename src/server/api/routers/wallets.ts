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
        type: z.enum(["atLeast", "all", "any"]),
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
          type: input.type,
        },
      });
    }),

  updateWalletVerifiedList: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        verified: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          verified: input.verified,
        },
      });
    }),

  updateWallet: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        name: z.string(),
        description: z.string(),
        isArchived: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          name: input.name,
          description: input.description,
          isArchived: input.isArchived,
        },
      });
    }),

  updateWalletSignersDescriptions: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        signersDescriptions: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          signersDescriptions: input.signersDescriptions,
        },
      });
    }),

  getWalletInvite: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.walletInvite.findUnique({
        where: {
          id: input.walletId,
        },
      });
    }),

  createWalletInvite: publicProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string(),
        signersAddresses: z.array(z.string()),
        signersDescriptions: z.array(z.string()),
        ownerAddress: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.walletInvite.create({
        data: {
          name: input.name,
          description: input.description,
          signersAddresses: input.signersAddresses,
          signersDescriptions: input.signersDescriptions,
          ownerAddress: input.ownerAddress,
        },
      });
    }),

  updateWalletInvite: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        name: z.string(),
        description: z.string(),
        signersAddresses: z.array(z.string()),
        signersDescriptions: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.walletInvite.update({
        where: {
          id: input.walletId,
        },
        data: {
          name: input.name,
          description: input.description,
          signersAddresses: input.signersAddresses,
          signersDescriptions: input.signersDescriptions,
        },
      });
    }),

  updateWalletInviteSigners: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        signersAddresses: z.array(z.string()),
        signersDescriptions: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.walletInvite.update({
        where: {
          id: input.walletId,
        },
        data: {
          signersAddresses: input.signersAddresses,
          signersDescriptions: input.signersDescriptions,
        },
      });
    }),

  deleteWalletInvite: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.walletInvite.delete({
        where: {
          id: input.walletId,
        },
      });
    }),
});
