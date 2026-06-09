import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/api/trpc";
import type { AuthCtx } from "@/server/api/trpc";
import type { RawImportBodies } from "@/types/wallet";
import { Prisma } from "@prisma/client";
import { audit } from "@/lib/observability/audit";

const requireSessionAddress = (ctx: AuthCtx) => {
  const address = ctx.session?.user?.id ?? ctx.sessionAddress;
  if (!address) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return address;
};

const assertWalletAccess = async (ctx: AuthCtx, walletId: string, requester: string | string[]) => {
  const wallet = await ctx.db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }

  const requesters = Array.isArray(requester) ? requester : [requester];
  const sessionWallets: string[] = ctx.sessionWallets ?? [];
  const allRequesters = [...requesters, ...sessionWallets];

  const isSigner = allRequesters.some((addr) =>
    Array.isArray(wallet.signersAddresses) && wallet.signersAddresses.includes(addr)
  );
  const isOwner = allRequesters.some((addr) => wallet.ownerAddress === addr);

  if (!isSigner && !isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a signer of this wallet" });
  }

  return wallet;
};

// Check if user is the owner of the wallet
const assertNewWalletOwnerAccess = async (ctx: AuthCtx, walletId: string, requester: string) => {
  const wallet = await ctx.db.newWallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }
  
  // Check if requester is the owner (exact match)
  const isOwner = wallet.ownerAddress === requester;
  
  // Also check if ownerAddress is in sessionWallets (user might have multiple authorized wallets)
  const sessionWallets: string[] = ctx.sessionWallets ?? [];
  const isOwnerViaSession = sessionWallets.includes(wallet.ownerAddress);
  
  if (!isOwner && !isOwnerViaSession) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can perform this action" });
  }
  return wallet;
};

// Check if user is a signer or owner (for read access)
const assertNewWalletSignerAccess = async (ctx: AuthCtx, walletId: string, requester: string) => {
  const wallet = await ctx.db.newWallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }
  
  // Check if user is the owner (owners always have full access)
  const isOwner = wallet.ownerAddress === requester;
  
  // Also check if ownerAddress is in sessionWallets (user might have multiple authorized wallets)
  const sessionWallets: string[] = ctx.sessionWallets ?? [];
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
const assertNewWalletAccess = async (ctx: AuthCtx, walletId: string, requester: string) => {
  return assertNewWalletSignerAccess(ctx, walletId, requester);
};

// Shape of the wallet export payload exchanged by the cross-instance
// import flow and the JSON-backup file. Hoisted above the router so the
// discriminated union in importWallet can reference it during module
// initialization (the const is declared further down too — keeping the
// canonical definition here avoids a temporal-dead-zone hazard).
const walletExportPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string().min(1).max(256),
  description: z.string().max(2000),
  signersAddresses: z.array(z.string()),
  signersStakeKeys: z.array(z.string()),
  signersDRepKeys: z.array(z.string()),
  signersDescriptions: z.array(z.string()),
  numRequiredSigners: z.number().int().nullable(),
  scriptCbor: z.string().min(1),
  stakeCredentialHash: z.string().nullable(),
  type: z.string(),
  rawImportBodies: z.any().nullable(),
});

type WalletExportPayload = z.infer<typeof walletExportPayloadSchema>;

function assertCallerIsClaimedSigner(
  claimed: string,
  callerAddresses: Set<string>,
) {
  if (!callerAddresses.has(claimed)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Claimed verified signer does not match your session",
    });
  }
}

function assertSignerOnPayload(payload: WalletExportPayload, address: string) {
  const isSigner =
    payload.signersStakeKeys.includes(address) ||
    payload.signersAddresses.includes(address);
  if (!isSigner) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Verified signer is not listed on the source wallet",
    });
  }
}

function walletDataFromPayload(
  payload: WalletExportPayload,
  provenance: Record<string, unknown>,
  lockedSigners: boolean,
  ownerAddress: string,
): Prisma.WalletCreateInput {
  // Carry through any pre-existing rawImportBodies (e.g. Summon multisig
  // metadata) so the imported wallet keeps resolving via the existing
  // buildWallet 'summon' branch, then layer our provenance on top.
  const existing = (payload.rawImportBodies ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = {
    ...existing,
    provenance,
    lockedSigners,
  };
  return {
    name: payload.name,
    description: payload.description,
    signersAddresses: payload.signersAddresses,
    signersStakeKeys: payload.signersStakeKeys,
    signersDRepKeys: payload.signersDRepKeys,
    signersDescriptions: payload.signersDescriptions,
    numRequiredSigners: payload.numRequiredSigners as unknown as number,
    scriptCbor: payload.scriptCbor,
    stakeCredentialHash: payload.stakeCredentialHash ?? undefined,
    type: payload.type,
    rawImportBodies: JSON.parse(JSON.stringify(merged)) as Prisma.InputJsonValue,
    ownerAddress,
  };
}

export const walletRouter = createTRPCRouter({
  // Read operations stay public but validate signer membership by address param
  getUserWallets: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
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
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : ctx.sessionAddress
          ? [ctx.sessionAddress]
          : [];

      if (addresses.length === 0) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (!addresses.includes(input.address)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }

      const wallet = await ctx.db.wallet.findUnique({
        where: {
          id: input.walletId,
          signersAddresses: {
            has: input.address,
          },
        },
      });

      if (!wallet) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a signer of this wallet" });
      }

      if (
        !Array.isArray(wallet.signersAddresses) ||
        !wallet.signersAddresses.includes(input.address)
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a signer of this wallet" });
      }

      return wallet;
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
        ownerAddress: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      try {
        const numRequired = (input.type === "all" || input.type === "any") ? null : input.numRequiredSigners;

        const signersStakeKeys = (input.signersStakeKeys || []).map(key =>
          key === null || key === undefined ? "" : key
        );
        const signersDRepKeys = (input.signersDRepKeys || []).map(key =>
          key === null || key === undefined ? "" : key
        );

        let rawImportBodiesValue: Prisma.InputJsonValue | undefined = undefined;
        if (input.rawImportBodies) {
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
          ...(input.ownerAddress != null && { ownerAddress: input.ownerAddress }),
        };

        const wallet = await ctx.db.wallet.create({ data });
        void audit(ctx.db, {
          actorAddress: sessionAddress,
          actorType: "user",
          action: "wallet.create",
          resourceType: "wallet",
          resourceId: wallet.id,
          ip: ctx.ip ?? null,
          outcome: "success",
          metadata: {
            type: input.type,
            numRequiredSigners: numRequired,
            signerCount: input.signersAddresses.length,
            ownerAddress: input.ownerAddress ?? null,
          },
        });
        return wallet;
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
        profileImageIpfsUrl: z.string().url().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      const updateData: {
        name: string;
        description: string;
        isArchived: boolean;
        profileImageIpfsUrl?: string | null;
      } = {
        name: input.name,
        description: input.description,
        isArchived: input.isArchived,
      };
      
      // Only update profileImageIpfsUrl if it's explicitly provided
      if (input.profileImageIpfsUrl !== undefined) {
        updateData.profileImageIpfsUrl = input.profileImageIpfsUrl ?? null;
      }
      
      return ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: updateData,
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

  getUserNewWallets: protectedProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : ctx.sessionAddress
          ? [ctx.sessionAddress]
          : [];
      if (!addresses.includes(input.address)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
      return ctx.db.newWallet.findMany({
        where: {
          ownerAddress: input.address,
        },
      });
    }),

  getUserNewWalletsNotOwner: protectedProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : ctx.sessionAddress
          ? [ctx.sessionAddress]
          : [];
      if (!addresses.includes(input.address)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
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
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      
      // Allow ownerAddress to be either the sessionAddress or any address in sessionWallets
      const isAuthorized = 
        sessionAddress === input.ownerAddress || 
        sessionWallets.includes(input.ownerAddress);
      
      if (!isAuthorized) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Owner address mismatch" });
      }
      const numRequired = (input.scriptType === "all" || input.scriptType === "any") ? null : input.numRequiredSigners;
      const wallet = await ctx.db.newWallet.create({
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
      void audit(ctx.db, {
        actorAddress: sessionAddress,
        actorType: "user",
        action: "wallet.new_create",
        resourceType: "newWallet",
        resourceId: wallet.id,
        ip: ctx.ip ?? null,
        outcome: "success",
        metadata: {
          scriptType: input.scriptType ?? null,
          numRequiredSigners: numRequired,
          signerCount: input.signersAddresses.length,
          ownerAddress: input.ownerAddress,
        },
      });
      return wallet;
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
        void audit(ctx.db, {
          actorAddress: requester,
          actorType: "user",
          action: "wallet.owner_claim",
          resourceType: "newWallet",
          resourceId: input.walletId,
          ip: ctx.ip ?? null,
          outcome: "denied",
          reason: "Already claimed, not eligible, or wallet not found",
          metadata: { requestedOwner: input.ownerAddress },
        });
        return ctx.db.newWallet.findUnique({ where: { id: input.walletId } });
      }

      void audit(ctx.db, {
        actorAddress: requester,
        actorType: "user",
        action: "wallet.owner_claim",
        resourceType: "newWallet",
        resourceId: input.walletId,
        ip: ctx.ip ?? null,
        outcome: "success",
        metadata: { newOwner: input.ownerAddress, previousOwner: "all" },
      });
      return ctx.db.newWallet.findUnique({ where: { id: input.walletId } });
    }),

  deleteNewWallet: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      // Only owners can delete the wallet
      await assertNewWalletOwnerAccess(ctx, input.walletId, sessionAddress);
      const deleted = await ctx.db.newWallet.delete({
        where: {
          id: input.walletId,
        },
      });
      void audit(ctx.db, {
        actorAddress: sessionAddress,
        actorType: "user",
        action: "wallet.new_delete",
        resourceType: "newWallet",
        resourceId: input.walletId,
        ip: ctx.ip ?? null,
        outcome: "success",
      });
      return deleted;
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
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const sessionAddress = requireSessionAddress(ctx);
      const requesters = sessionWallets.length > 0 ? sessionWallets : [sessionAddress];
      await assertWalletAccess(ctx, input.walletId, requesters);
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
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const sessionAddress = requireSessionAddress(ctx);
      const requesters = sessionWallets.length > 0 ? sessionWallets : [sessionAddress];
      await assertWalletAccess(ctx, input.walletId, requesters);
      const updated = await ctx.db.wallet.update({
        where: {
          id: input.walletId,
        },
        data: {
          isArchived: true,
        },
      });
      void audit(ctx.db, {
        actorAddress: sessionAddress,
        actorType: "user",
        action: "wallet.archive",
        resourceType: "wallet",
        resourceId: input.walletId,
        ip: ctx.ip ?? null,
        outcome: "success",
      });
      return updated;
    }),

  // Read the wallet config in the same shape used by the cross-instance
  // export endpoint, so the "Download JSON backup" button on the wallet
  // info page produces a file that the import wizard's JSON tab can
  // ingest one-for-one.
  exportWallet: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const requesters = sessionWallets.length > 0 ? sessionWallets : [sessionAddress];
      const wallet = await assertWalletAccess(ctx, input.walletId, requesters);

      const payload = {
        schemaVersion: 1 as const,
        id: wallet.id,
        name: wallet.name,
        description: wallet.description ?? "",
        signersAddresses: wallet.signersAddresses,
        signersStakeKeys: wallet.signersStakeKeys,
        signersDRepKeys: wallet.signersDRepKeys,
        signersDescriptions: wallet.signersDescriptions,
        numRequiredSigners: wallet.numRequiredSigners,
        scriptCbor: wallet.scriptCbor,
        stakeCredentialHash: wallet.stakeCredentialHash ?? null,
        type: wallet.type,
        rawImportBodies: wallet.rawImportBodies ?? null,
      };
      const { hashPayload } = await import("@/pages/api/v1/exportWallet/redeem");
      return { payload, payloadHash: hashPayload(payload) };
    }),

  // Discriminated-union importer covering all wizard sources. Delegates
  // to the same wallet.create write that createWallet uses — no parallel
  // writer. Provenance lives in rawImportBodies.provenance; lockedSigners
  // is set for sources where the canonical signer list lives elsewhere
  // (Summon, instance, json).
  importWallet: protectedProcedure
    .input(
      z.discriminatedUnion("source", [
        z.object({
          source: z.literal("instance"),
          originUrl: z.string().url(),
          originalWalletId: z.string(),
          verifiedSigner: z.string(),
          payload: walletExportPayloadSchema,
        }),
        z.object({
          source: z.literal("json"),
          sourceInstance: z.string(),
          payload: walletExportPayloadSchema,
          payloadHash: z.string(),
        }),
        z.object({
          source: z.literal("cbor"),
          name: z.string().min(1).max(256),
          description: z.string().max(2000),
          signersAddresses: z.array(z.string()),
          signersStakeKeys: z.array(z.string()),
          signersDRepKeys: z.array(z.string()),
          signersDescriptions: z.array(z.string()),
          scriptCbor: z.string().min(1),
          numRequiredSigners: z.number().int().min(1),
          scriptType: z.enum(["all", "any", "atLeast"]),
          stakeCredentialHash: z.string().optional().nullable(),
          verifiedSigner: z.string(),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const callerAddresses = new Set([sessionAddress, ...sessionWallets]);

      const now = new Date().toISOString();
      let data: Prisma.WalletCreateInput;
      let provenance: Record<string, unknown>;
      let lockedSigners = false;

      if (input.source === "instance") {
        assertCallerIsClaimedSigner(input.verifiedSigner, callerAddresses);
        assertSignerOnPayload(input.payload, input.verifiedSigner);
        provenance = {
          origin: "instance",
          originUrl: input.originUrl,
          originalWalletId: input.originalWalletId,
          verifiedSigner: input.verifiedSigner,
          importedAt: now,
        };
        lockedSigners = true;
        data = walletDataFromPayload(input.payload, provenance, lockedSigners, sessionAddress);
      } else if (input.source === "json") {
        const { hashPayload } = await import("@/pages/api/v1/exportWallet/redeem");
        const expected = hashPayload(input.payload);
        if (expected !== input.payloadHash) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payload hash mismatch — file may be corrupt or tampered",
          });
        }
        const claimedAddresses = [
          ...callerAddresses,
        ].filter((addr) =>
          input.payload.signersStakeKeys.includes(addr) ||
          input.payload.signersAddresses.includes(addr),
        );
        if (claimedAddresses.length === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Your connected wallet is not a signer on this backup",
          });
        }
        provenance = {
          origin: "json",
          sourceInstance: input.sourceInstance,
          originalWalletId: input.payload.id,
          payloadHash: input.payloadHash,
          importedAt: now,
        };
        lockedSigners = true;
        data = walletDataFromPayload(input.payload, provenance, lockedSigners, sessionAddress);
      } else {
        // source === "cbor"
        assertCallerIsClaimedSigner(input.verifiedSigner, callerAddresses);
        const claimedIndex = input.signersStakeKeys.findIndex(
          (k) => k === input.verifiedSigner,
        );
        const claimedAddressIndex = input.signersAddresses.findIndex(
          (a) => a === input.verifiedSigner,
        );
        if (claimedIndex < 0 && claimedAddressIndex < 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Your connected wallet must be in the signer list",
          });
        }
        provenance = {
          origin: "cbor",
          verifiedSigner: input.verifiedSigner,
          importedAt: now,
        };
        data = {
          name: input.name,
          description: input.description,
          signersAddresses: input.signersAddresses,
          signersStakeKeys: input.signersStakeKeys,
          signersDRepKeys: input.signersDRepKeys,
          signersDescriptions: input.signersDescriptions,
          numRequiredSigners:
            input.scriptType === "all" || input.scriptType === "any"
              ? (null as unknown as number)
              : input.numRequiredSigners,
          scriptCbor: input.scriptCbor,
          stakeCredentialHash: input.stakeCredentialHash ?? undefined,
          type: input.scriptType,
          rawImportBodies: {
            provenance,
            lockedSigners: false,
          } as Prisma.InputJsonValue,
          ownerAddress: sessionAddress,
        };
      }

      const wallet = await ctx.db.wallet.create({ data });
      return wallet;
    }),
});
