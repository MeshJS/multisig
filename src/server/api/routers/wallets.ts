import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import type { RawImportBodies } from "@/types/wallet";
import { Prisma } from "@prisma/client";

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
        signersStakeKeys: z.array(z.string().nullable()).nullable(),
        signersDRepKeys: z.array(z.string().optional()).nullable(),
        numRequiredSigners: z.number(),
        scriptCbor: z.string(),
        stakeCredentialHash: z.string().optional(),
        type: z.enum(["atLeast", "all", "any"]),
        rawImportBodies: z.any().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const numRequired = (input.type === "all" || input.type === "any") ? null : input.numRequiredSigners;
        
        // Convert null/undefined values to empty strings to match Prisma schema
        // Keep array length to match signersAddresses
        const signersStakeKeys = (input.signersStakeKeys || []).map(key => 
          key === null || key === undefined ? "" : key
        );
        const signersDRepKeys = (input.signersDRepKeys || []).map(key => 
          key === null || key === undefined ? "" : key
        );
        
        // Ensure rawImportBodies is properly serialized if present
        let rawImportBodiesValue: Prisma.InputJsonValue | null = null;
        if (input.rawImportBodies) {
          // If it's already a plain object, use it directly
          // Otherwise, serialize it to ensure it's JSON-compatible
          rawImportBodiesValue = JSON.parse(JSON.stringify(input.rawImportBodies)) as Prisma.InputJsonValue;
        }
        
        const data: Prisma.WalletCreateInput = {
          name: input.name,
          description: input.description,
          signersAddresses: input.signersAddresses,
          signersDescriptions: input.signersDescriptions,
          signersStakeKeys: signersStakeKeys,
          signersDRepKeys: signersDRepKeys,
          numRequiredSigners: numRequired as any,
          scriptCbor: input.scriptCbor,
          stakeCredentialHash: input.stakeCredentialHash,
          type: input.type,
          rawImportBodies: rawImportBodiesValue,
        };

        return ctx.db.wallet.create({ data });
      } catch (error) {
        console.error("Error creating wallet:", error);
        throw error;
      }
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
        signersDRepKeys: z.array(z.string()),
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
          signersDRepKeys: input.signersDRepKeys,
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
        signersDRepKeys: z.array(z.string()),
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
          signersDRepKeys: input.signersDRepKeys,
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
        signersDRepKeys: z.array(z.string()),
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
          signersDRepKeys: input.signersDRepKeys,
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

  updateNewWalletOwner: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        ownerAddress: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Look up user's stake address for stake-key membership check
      const user = await ctx.db.user.findUnique({ where: { address: input.ownerAddress } });
      const stakeAddr = user?.stakeAddress || "";

      // Atomic conditional claim: only if owner is currently "all" AND caller qualifies
      const result = await ctx.db.newWallet.updateMany({
        where: {
          id: input.walletId,
          ownerAddress: "all",
          OR: [
            { signersAddresses: { has: input.ownerAddress } },
            stakeAddr ? { signersStakeKeys: { has: stakeAddr } } : { id: "__never__" },
          ],
        },
        data: { ownerAddress: input.ownerAddress },
      });

      if (result.count === 0) {
        // Either already claimed, not eligible, or wallet not found
        return ctx.db.newWallet.findUnique({ where: { id: input.walletId } });
      }

      return ctx.db.newWallet.findUnique({ where: { id: input.walletId } });
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

  setMigrationTarget: publicProcedure
    .input(z.object({ 
      walletId: z.string(),
      migrationTargetWalletId: z.string()
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          migrationTargetWalletId: input.migrationTargetWalletId,
        },
      });
    }),

  clearMigrationTarget: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          migrationTargetWalletId: null,
        },
      });
    }),

  abortMigration: publicProcedure
    .input(z.object({ 
      walletId: z.string(),
      newWalletId: z.string().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      // Try to delete the new wallet if it exists (it might be a NewWallet or Wallet)
      if (input.newWalletId) {
        try {
          // First check if it exists in NewWallet table
          const newWallet = await ctx.db.newWallet.findUnique({
            where: { id: input.newWalletId }
          });
          
          if (newWallet) {
            await ctx.db.newWallet.delete({
              where: { id: input.newWalletId }
            });
            console.log("Deleted NewWallet:", input.newWalletId);
          } else {
            // Check if it exists in Wallet table
            const wallet = await ctx.db.wallet.findUnique({
              where: { id: input.newWalletId }
            });
            
            if (wallet) {
              await ctx.db.wallet.delete({
                where: { id: input.newWalletId }
              });
              console.log("Deleted Wallet:", input.newWalletId);
            } else {
              console.log("No wallet found with ID:", input.newWalletId, "- migration might be in a different state");
            }
          }
        } catch (error) {
          console.error("Error deleting wallet during migration abort:", error);
          // Continue with clearing migration target even if deletion fails
        }
      }

      // Clear the migration target reference from the original wallet
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          migrationTargetWalletId: null,
        },
      });
    }),

  archiveWallet: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          isArchived: true,
        },
      });
    }),
});
