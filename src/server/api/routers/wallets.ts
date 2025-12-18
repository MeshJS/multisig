import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/api/trpc";
import type { RawImportBodies } from "@/types/wallet";
import { Prisma } from "@prisma/client";

const requireSessionAddress = (ctx: any) => {
  const address = ctx.session?.user?.id ?? ctx.sessionAddress;
  if (!address) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return address;
};

const assertWalletAccess = async (ctx: any, walletId: string, requester: string) => {
  const wallet = await ctx.db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }

  const isSigner =
    Array.isArray(wallet.signersAddresses) && wallet.signersAddresses.includes(requester);
  const isOwner = wallet.ownerAddress === requester || wallet.ownerAddress === "all";

  if (!isSigner && !isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a signer of this wallet" });
  }

  return wallet;
};

// Check if user is the owner of the wallet
const assertNewWalletOwnerAccess = async (ctx: any, walletId: string, requester: string) => {
  const wallet = await ctx.db.newWallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }
  
  // Check if requester is the owner (exact match)
  const isOwner = wallet.ownerAddress === requester;
  
  // Also check if ownerAddress is in sessionWallets (user might have multiple authorized wallets)
  const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
  const isOwnerViaSession = sessionWallets.includes(wallet.ownerAddress);
  
  if (!isOwner && !isOwnerViaSession) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can perform this action" });
  }
  return wallet;
};

// Check if user is a signer or owner (for read access)
const assertNewWalletSignerAccess = async (ctx: any, walletId: string, requester: string) => {
  const wallet = await ctx.db.newWallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }
  
  // Check if user is the owner (owners always have full access)
  const isOwner = wallet.ownerAddress === requester;
  
  // Also check if ownerAddress is in sessionWallets (user might have multiple authorized wallets)
  const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
  const isOwnerViaSession = sessionWallets.includes(wallet.ownerAddress);
  
  if (isOwner || isOwnerViaSession) {
    return wallet;
  }
  
  // Check if user is a signer
  const isSigner =
    Array.isArray(wallet.signersAddresses) && wallet.signersAddresses.includes(requester);
  
  // Also check if any signer address is in sessionWallets
  const isSignerViaSession = Array.isArray(wallet.signersAddresses) && 
    wallet.signersAddresses.some((addr: string) => sessionWallets.includes(addr));
  
  if (!isSigner && !isSignerViaSession) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this wallet" });
  }
  return wallet;
};

// Check if user can read the wallet (signer or owner)
const assertNewWalletAccess = async (ctx: any, walletId: string, requester: string) => {
  return assertNewWalletSignerAccess(ctx, walletId, requester);
};

export const walletRouter = createTRPCRouter({
  // Read operations stay public but validate signer membership by address param
  getUserWallets: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : ctx.sessionAddress
          ? [ctx.sessionAddress]
          : [];
      // If user has an active session, validate that the requested address is authorized
      // Throw error if address doesn't match (security: prevent unauthorized access)
      if (addresses.length > 0 && !addresses.includes(input.address)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
      // Query wallets where the user is a signer
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
      const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : ctx.sessionAddress
          ? [ctx.sessionAddress]
          : [];
      // If user has an active session, validate that the requested address is authorized
      // Throw error if address doesn't match (security: prevent unauthorized access)
      if (addresses.length > 0 && !addresses.includes(input.address)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
      return ctx.db.wallet.findUnique({
        where: {
          id: input.walletId,
          signersAddresses: {
            has: input.address,
          },
        },
      });
    }),

  createWallet: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(256),
        description: z.string().max(2000),
        signersAddresses: z.array(z.string()),
        signersDescriptions: z.array(z.string()),
        signersStakeKeys: z.array(z.string().nullable()).nullable(),
        signersDRepKeys: z.array(z.string().optional()).nullable(),
        numRequiredSigners: z.number().min(1),
        scriptCbor: z.string().min(1),
        stakeCredentialHash: z.string().optional(),
        type: z.enum(["atLeast", "all", "any"]),
        rawImportBodies: z.any().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireSessionAddress(ctx);
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
        let rawImportBodiesValue: Prisma.InputJsonValue | undefined = undefined;
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

  updateWalletVerifiedList: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        verified: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          verified: input.verified,
        },
      });
    }),

  updateWallet: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        name: z.string().min(1).max(256),
        description: z.string().max(2000),
        isArchived: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
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

  updateWalletSignersDescriptions: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        signersStakeKeys: z.array(z.string()),
        signersDRepKeys: z.array(z.string()),
        signersDescriptions: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
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
      const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : ctx.sessionAddress
          ? [ctx.sessionAddress]
          : [];
      // If user has an active session, validate that the requested address is authorized
      // Throw error if address doesn't match (security: prevent unauthorized access)
      if (addresses.length > 0 && !addresses.includes(input.address)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
      // Query new wallets owned by the user
      return ctx.db.newWallet.findMany({
        where: {
          ownerAddress: input.address,
        },
      });
    }),

  getUserNewWalletsNotOwner: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : ctx.sessionAddress
          ? [ctx.sessionAddress]
          : [];
      // If user has an active session, validate that the requested address is authorized
      // Throw error if address doesn't match (security: prevent unauthorized access)
      if (addresses.length > 0 && !addresses.includes(input.address)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
      // Query new wallets where user is a signer but not the owner
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

  getNewWallet: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertNewWalletAccess(ctx, input.walletId, sessionAddress);
      return ctx.db.newWallet.findUnique({
        where: {
          id: input.walletId,
        },
      });
    }),

  createNewWallet: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(256),
        description: z.string().max(2000),
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
      const sessionAddress = requireSessionAddress(ctx);
      const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
      
      // Allow ownerAddress to be either the sessionAddress or any address in sessionWallets
      const isAuthorized = 
        sessionAddress === input.ownerAddress || 
        sessionWallets.includes(input.ownerAddress);
      
      if (!isAuthorized) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Owner address mismatch" });
      }
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

  updateNewWallet: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        name: z.string().min(1).max(256),
        description: z.string().max(2000),
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
      const sessionAddress = requireSessionAddress(ctx);
      // Only owners can update the entire wallet
      await assertNewWalletOwnerAccess(ctx, input.walletId, sessionAddress);
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

  updateNewWalletSigners: protectedProcedure
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
      const sessionAddress = requireSessionAddress(ctx);
      // Only owners can update all signers
      await assertNewWalletOwnerAccess(ctx, input.walletId, sessionAddress);
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

  updateNewWalletSignersDescriptions: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        signersDescriptions: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const wallet = await assertNewWalletSignerAccess(ctx, input.walletId, sessionAddress);
      
      // Check if user is the owner - owners can update all descriptions
      const isOwner = wallet.ownerAddress === sessionAddress;
      
      if (!isOwner) {
        // Non-owners can only update their own description
        // Find the signer's index in the signersAddresses array
        const signerIndex = wallet.signersAddresses.indexOf(sessionAddress);
        if (signerIndex < 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You are not a signer of this wallet" });
        }
        
        // Verify that only the signer's own description is being changed
        // All other descriptions must remain the same
        for (let i = 0; i < wallet.signersDescriptions.length; i++) {
          if (i !== signerIndex && wallet.signersDescriptions[i] !== input.signersDescriptions[i]) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can only update your own description" });
          }
        }
        
        // Verify the array lengths match
        if (input.signersDescriptions.length !== wallet.signersDescriptions.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Descriptions array length mismatch" });
        }
      }
      
      // Owners can update all, signers can only update their own (validated above)
      return ctx.db.newWallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          signersDescriptions: input.signersDescriptions,
        },
      });
    }),

  updateNewWalletOwner: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        ownerAddress: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const requester = sessionAddress;
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
            { signersAddresses: { has: requester } },
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

  deleteNewWallet: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      // Only owners can delete the wallet
      await assertNewWalletOwnerAccess(ctx, input.walletId, sessionAddress);
      return ctx.db.newWallet.delete({
        where: {
          id: input.walletId,
        },
      });
    }),

  updateWalletClarityApiKey: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        clarityApiKey: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          clarityApiKey: input.clarityApiKey,
        },
      });
    }),

  setMigrationTarget: protectedProcedure
    .input(z.object({ 
      walletId: z.string(),
      migrationTargetWalletId: z.string()
    }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          migrationTargetWalletId: input.migrationTargetWalletId,
        },
      });
    }),

  clearMigrationTarget: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          migrationTargetWalletId: null,
        },
      });
    }),

  abortMigration: protectedProcedure
    .input(z.object({ 
      walletId: z.string(),
      newWalletId: z.string().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
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

  archiveWallet: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
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
