import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import type { AuthCtx } from "@/server/api/trpc";
import { assertWalletAccess } from "@/server/api/auth";

const requireSessionAddress = (ctx: AuthCtx) => {
  const address = ctx.session?.user?.id ?? ctx.sessionAddress;
  if (!address) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return address;
};

const assertMigrationOwner = async (ctx: AuthCtx, migrationId: string, requester: string | string[]) => {
  const migration = await ctx.db.migration.findUnique({ where: { id: migrationId } });
  if (!migration) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Migration not found" });
  }
  
  // Check if requester is a single address or array of addresses
  const requesterAddresses = Array.isArray(requester) ? requester : [requester];
  
  if (!requesterAddresses.includes(migration.ownerAddress)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not owner of migration" });
  }
  return migration;
};

export const migrationRouter = createTRPCRouter({
  // Get pending migrations for a user – require authenticated session whose address matches owner
  getPendingMigrations: protectedProcedure
    .input(z.object({ ownerAddress: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : [requireSessionAddress(ctx)];
      if (!addresses.includes(input.ownerAddress)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
      return ctx.db.migration.findMany({
        where: {
          ownerAddress: input.ownerAddress,
          status: {
            in: ["pending", "in_progress"]
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      });
    }),

  // Get a specific migration by ID
  getMigration: protectedProcedure
    .input(z.object({ migrationId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Check against sessionWallets array like getPendingMigrations does
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : [requireSessionAddress(ctx)];
      
      const migration = await assertMigrationOwner(ctx, input.migrationId, addresses);
      return migration;
    }),

  // Create a new migration
  createMigration: protectedProcedure
    .input(z.object({
      originalWalletId: z.string(),
      ownerAddress: z.string(),
      migrationData: z.any().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : [requireSessionAddress(ctx)];
      if (!addresses.includes(input.ownerAddress)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
      // Proving control of an address says nothing about the wallet being
      // migrated. Without this, any signed-in user could open a migration for
      // someone else's wallet id — and because only one active migration is
      // allowed per wallet, that blocks the real signers from migrating until
      // the stranger cancels it.
      // The initiator itself must belong to the wallet: assertWalletAccess
      // would also accept any other address in a multi-wallet session, which
      // would record the lock under an address that is not a signer.
      const wallet = await ctx.db.wallet.findUnique({
        where: { id: input.originalWalletId },
      });
      if (!wallet) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
      }
      const initiatorBelongs =
        wallet.ownerAddress === input.ownerAddress ||
        (Array.isArray(wallet.signersAddresses) &&
          wallet.signersAddresses.includes(input.ownerAddress));
      if (!initiatorBelongs) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this wallet" });
      }

      // Check if there's already an active migration for this wallet
      const existingMigration = await ctx.db.migration.findFirst({
        where: {
          originalWalletId: input.originalWalletId,
          status: {
            in: ["pending", "in_progress"]
          }
        }
      });

      if (existingMigration) {
        throw new TRPCError({ 
          code: "CONFLICT", 
          message: `A migration is already in progress for this wallet. Migration started by ${existingMigration.ownerAddress} at ${existingMigration.createdAt.toISOString()}. Please wait for it to complete or cancel it first.` 
        });
      }

      return ctx.db.migration.create({
        data: {
          originalWalletId: input.originalWalletId,
          ownerAddress: input.ownerAddress,
          migrationData: input.migrationData,
          currentStep: 0,
          status: "pending"
        }
      });
    }),

  // Update migration step
  updateMigrationStep: protectedProcedure
    .input(z.object({
      migrationId: z.string(),
      currentStep: z.number(),
      status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
      newWalletId: z.string().optional(),
      errorMessage: z.string().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      // Check against sessionWallets array like getPendingMigrations does
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : [requireSessionAddress(ctx)];
      
      await assertMigrationOwner(ctx, input.migrationId, addresses);
      const updateData: any = {
        currentStep: input.currentStep,
        updatedAt: new Date()
      };

      if (input.status) {
        updateData.status = input.status;
        if (input.status === "completed") {
          updateData.completedAt = new Date();
        }
      }

      if (input.newWalletId) {
        updateData.newWalletId = input.newWalletId;
      }

      if (input.errorMessage) {
        updateData.errorMessage = input.errorMessage;
      }

      return ctx.db.migration.update({
        where: {
          id: input.migrationId
        },
        data: updateData
      });
    }),

  // Update migration data
  updateMigrationData: protectedProcedure
    .input(z.object({
      migrationId: z.string(),
      migrationData: z.any()
    }))
    .mutation(async ({ ctx, input }) => {
      // Check against sessionWallets array like getPendingMigrations does
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : [requireSessionAddress(ctx)];
      
      await assertMigrationOwner(ctx, input.migrationId, addresses);
      return ctx.db.migration.update({
        where: {
          id: input.migrationId
        },
        data: {
          migrationData: input.migrationData,
          updatedAt: new Date()
        }
      });
    }),

  // Cancel a migration
  cancelMigration: protectedProcedure
    .input(z.object({ migrationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check against sessionWallets array like getPendingMigrations does
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : [requireSessionAddress(ctx)];
      
      await assertMigrationOwner(ctx, input.migrationId, addresses);
      // Delete the migration record completely
      return ctx.db.migration.delete({
        where: {
          id: input.migrationId
        }
      });
    }),

  // Complete a migration
  completeMigration: protectedProcedure
    .input(z.object({ migrationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check against sessionWallets array like getPendingMigrations does
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const addresses = sessionWallets.length
        ? sessionWallets
        : [requireSessionAddress(ctx)];
      
      await assertMigrationOwner(ctx, input.migrationId, addresses);
      return ctx.db.migration.update({
        where: {
          id: input.migrationId
        },
        data: {
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date()
        }
      });
    }),

  // Get migration by original wallet ID
  getMigrationByOriginalWallet: protectedProcedure
    .input(z.object({ originalWalletId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Deliberately not owner-scoped: every signer must see a migration
      // another signer started, so they don't start a second one. It is still
      // wallet-scoped — the row carries the initiator's address and the
      // migration plan, which are nobody else's business.
      requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.originalWalletId);
      return ctx.db.migration.findFirst({
        where: {
          originalWalletId: input.originalWalletId,
          status: {
            in: ["pending", "in_progress"]
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      });
    })
});
