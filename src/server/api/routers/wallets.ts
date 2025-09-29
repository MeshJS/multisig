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
        signersStakeKeys: z.array(z.string()),
        numRequiredSigners: z.number(),
        scriptCbor: z.string(),
        stakeCredentialHash: z.string().optional(),
        type: z.enum(["atLeast", "all", "any"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const numRequired = (input.type === "all" || input.type === "any") ? null : input.numRequiredSigners;
      return ctx.db.wallet.create({
        data: {
          name: input.name,
          description: input.description,
          signersAddresses: input.signersAddresses,
          signersDescriptions: input.signersDescriptions,
          signersStakeKeys: input.signersStakeKeys,
          numRequiredSigners: numRequired as any,
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
        signersStakeKeys: z.array(z.string()),
        signersDRepKeys: z.array(z.string()),
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
          signersStakeKeys: input.signersStakeKeys,
          signersDRepKeys: input.signersDRepKeys,
        },
      });
    }),

  getUserNewWallets: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.newWallet.findMany({
        where: {
          ownerAddress: input.address,
        },
      });
    }),

  getUserNewWalletsNotOwner: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.newWallet.findMany({
        where: {
          signersAddresses: {
            has: input.address,
          },
          ownerAddress: {
            not: input.address,
          },
        },
      });
    }),

  getNewWallet: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.newWallet.findUnique({
        where: {
          id: input.walletId,
        },
      });
    }),

  createNewWallet: publicProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string(),
        signersAddresses: z.array(z.string()),
        signersDescriptions: z.array(z.string()),
        signersStakeKeys: z.array(z.string()),
        numRequiredSigners: z.number(),
        ownerAddress: z.string(),
        stakeCredentialHash: z.string().optional().nullable(),
        scriptType: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const numRequired = (input.scriptType === "all" || input.scriptType === "any") ? null : input.numRequiredSigners;
      return ctx.db.newWallet.create({
        data: {
          name: input.name,
          description: input.description,
          signersAddresses: input.signersAddresses,
          signersDescriptions: input.signersDescriptions,
          signersStakeKeys: input.signersStakeKeys,
          numRequiredSigners: numRequired as any,
          ownerAddress: input.ownerAddress,
          stakeCredentialHash: input.stakeCredentialHash,
          scriptType: input.scriptType,
        } as any,
      });
    }),

  updateNewWallet: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        name: z.string(),
        description: z.string(),
        signersAddresses: z.array(z.string()),
        signersDescriptions: z.array(z.string()),
        signersStakeKeys: z.array(z.string()),
        numRequiredSigners: z.number(),
        stakeCredentialHash: z.string().optional().nullable(),
        scriptType: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const numRequired = (input.scriptType === "all" || input.scriptType === "any") ? null : input.numRequiredSigners;
      return ctx.db.newWallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          name: input.name,
          description: input.description,
          signersAddresses: input.signersAddresses,
          signersDescriptions: input.signersDescriptions,
          signersStakeKeys: input.signersStakeKeys,
          numRequiredSigners: numRequired as any,
          stakeCredentialHash: input.stakeCredentialHash,
          scriptType: input.scriptType,
        } as any,
      });
    }),

  updateNewWalletSigners: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        signersAddresses: z.array(z.string()),
        signersDescriptions: z.array(z.string()),
        signersStakeKeys: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.newWallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          signersAddresses: input.signersAddresses,
          signersDescriptions: input.signersDescriptions,
          signersStakeKeys: input.signersStakeKeys,
        },
      });
    }),

  updateNewWalletSignersDescriptions: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        signersDescriptions: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.newWallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          signersDescriptions: input.signersDescriptions,
        },
      });
    }),

  deleteNewWallet: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.newWallet.delete({
        where: {
          id: input.walletId,
        },
      });
    }),

  updateWalletClarityApiKey: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        clarityApiKey: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          clarityApiKey: input.clarityApiKey,
        },
      });
    }),
});
