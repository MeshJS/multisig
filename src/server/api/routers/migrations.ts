import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

const requireSessionAddress = (ctx: any) => {
  const address = ctx.session?.user?.id ?? ctx.sessionAddress;
  if (!address) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return address;
};

const assertMigrationOwner = async (ctx: any, migrationId: string, requester: string) => {
  const migration = await ctx.db.migration.findUnique({ where: { id: migrationId } });
  if (!migration) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Migration not found" });
  }
  if (migration.ownerAddress !== requester) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not owner of migration" });
  }
  return migration;
};

export const migrationRouter = createTRPCRouter({
  // Get pending migrations for a user – require authenticated session whose address matches owner
  getPendingMigrations: protectedProcedure
    .input(z.object({ ownerAddress: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
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
      const sessionAddress = requireSessionAddress(ctx);
      const migration = await assertMigrationOwner(ctx, input.migrationId, sessionAddress);
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
      const sessionAddress = requireSessionAddress(ctx);
      if (sessionAddress !== input.ownerAddress) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
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
      const sessionAddress = requireSessionAddress(ctx);
      await assertMigrationOwner(ctx, input.migrationId, sessionAddress);
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
      const sessionAddress = requireSessionAddress(ctx);
      await assertMigrationOwner(ctx, input.migrationId, sessionAddress);
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
      const sessionAddress = requireSessionAddress(ctx);
      await assertMigrationOwner(ctx, input.migrationId, sessionAddress);
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
      const sessionAddress = requireSessionAddress(ctx);
      await assertMigrationOwner(ctx, input.migrationId, sessionAddress);
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
      const sessionAddress = requireSessionAddress(ctx);
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
