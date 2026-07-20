import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { audit } from "@/lib/observability/audit";
import { requireSessionAddress, assertWalletAccess } from "@/server/api/auth";
import { enqueueSignatureRequiredNotifications } from "@/lib/notifications/center";
import { summarizeSignableSignatureContext } from "@/lib/notifications/signatureContext";

export const signableRouter = createTRPCRouter({
  createSignable: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        payload: z.string().min(1),
        signatures: z.array(z.string()),
        signedAddresses: z.array(z.string()),
        method: z.string().min(1),
        state: z.number(),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const wallet = await assertWalletAccess(ctx, input.walletId, sessionAddress);
      const signable = await ctx.db.signable.create({
        data: {
          walletId: input.walletId,
          payload: input.payload,
          signatures: input.signatures,
          signedAddresses: input.signedAddresses,
          method: input.method,
          state: input.state,
          description: input.description,
        },
      });
      if (signable.state === 0) {
        try {
          await enqueueSignatureRequiredNotifications(ctx.db, {
            wallet,
            resourceType: "signable",
            resourceId: signable.id,
            signedAddresses: signable.signedAddresses,
            rejectedAddresses: signable.rejectedAddresses,
            creatorAddress: sessionAddress,
            description: signable.description,
            signatureContext: summarizeSignableSignatureContext({
              method: signable.method,
              description: signable.description,
            }),
          });
        } catch (error) {
          console.error("Failed to enqueue signable notifications", error);
        }
      }
      return signable;
    }),

  updateSignable: protectedProcedure
    .input(
      z.object({
        signableId: z.string(),
        signedAddresses: z.array(z.string()),
        rejectedAddresses: z.array(z.string()),
        signatures: z.array(z.string()),
        state: z.number(),
        txHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const signable = await ctx.db.signable.findUnique({ where: { id: input.signableId } });
      if (!signable) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Signable not found" });
      }
      await assertWalletAccess(ctx, signable.walletId, sessionAddress);
      const updated = await ctx.db.signable.update({
        where: {
          id: input.signableId,
        },
        data: {
          signedAddresses: input.signedAddresses,
          rejectedAddresses: input.rejectedAddresses,
          signatures: input.signatures,
          state: input.state,
        },
      });
      const justSigned = input.signedAddresses.includes(sessionAddress) &&
        !signable.signedAddresses.includes(sessionAddress);
      const justRejected = input.rejectedAddresses.includes(sessionAddress) &&
        !signable.rejectedAddresses.includes(sessionAddress);
      void audit(ctx.db, {
        actorAddress: sessionAddress,
        actorType: "user",
        action: justRejected
          ? "signable.reject"
          : justSigned
            ? "signable.sign"
            : "signable.update",
        resourceType: "signable",
        resourceId: input.signableId,
        ip: ctx.ip ?? null,
        outcome: "success",
        metadata: {
          walletId: signable.walletId,
          state: input.state,
          signersCount: input.signedAddresses.length,
          rejectionsCount: input.rejectedAddresses.length,
        },
      });
      return updated;
    }),

  deleteSignable: protectedProcedure
    .input(z.object({ signableId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const signable = await ctx.db.signable.findUnique({ where: { id: input.signableId } });
      if (!signable) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Signable not found" });
      }
      await assertWalletAccess(ctx, signable.walletId, sessionAddress);
      const deleted = await ctx.db.signable.delete({
        where: {
          id: input.signableId,
        },
      });
      void audit(ctx.db, {
        actorAddress: sessionAddress,
        actorType: "user",
        action: "signable.delete",
        resourceType: "signable",
        resourceId: input.signableId,
        ip: ctx.ip ?? null,
        outcome: "success",
        metadata: { walletId: signable.walletId },
      });
      return deleted;
    }),

  // Read-only queries require authenticated session whose address is a signer/owner
  getAllSignables: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      return await ctx.db.signable.findMany({
        where: {
          walletId: input.walletId,
          state: 1,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),

  getPendingSignables: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      return await ctx.db.signable.findMany({
        where: {
          walletId: input.walletId,
          state: 0,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),
    getCompleteSignables: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      return await ctx.db.signable.findMany({
        where: {
          walletId: input.walletId,
          state: 1,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),
});
