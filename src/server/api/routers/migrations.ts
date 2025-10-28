import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const migrationRouter = createTRPCRouter({
  // Get pending migrations for a user
  getPendingMigrations: publicProcedure
    .input(z.object({ ownerAddress: z.string() }))
    .query(async ({ ctx, input }) => {
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
  getMigration: publicProcedure
    .input(z.object({ migrationId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.migration.findUnique({
        where: {
          id: input.migrationId
        }
      });
    }),

  // Create a new migration
  createMigration: publicProcedure
    .input(z.object({
      originalWalletId: z.string(),
      ownerAddress: z.string(),
      migrationData: z.any().optional()
    }))
    .mutation(async ({ ctx, input }) => {
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
  updateMigrationStep: publicProcedure
    .input(z.object({
      migrationId: z.string(),
      currentStep: z.number(),
      status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
      newWalletId: z.string().optional(),
      errorMessage: z.string().optional()
    }))
    .mutation(async ({ ctx, input }) => {
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
  updateMigrationData: publicProcedure
    .input(z.object({
      migrationId: z.string(),
      migrationData: z.any()
    }))
    .mutation(async ({ ctx, input }) => {
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
  cancelMigration: publicProcedure
    .input(z.object({ migrationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Delete the migration record completely
      return ctx.db.migration.delete({
        where: {
          id: input.migrationId
        }
      });
    }),

  // Complete a migration
  completeMigration: publicProcedure
    .input(z.object({ migrationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
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
  getMigrationByOriginalWallet: publicProcedure
    .input(z.object({ originalWalletId: z.string() }))
    .query(async ({ ctx, input }) => {
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
