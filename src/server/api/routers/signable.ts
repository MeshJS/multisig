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

const assertWalletAccess = async (ctx: any, walletId: string, requester: string) => {
  const wallet = await ctx.db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }
  const isSigner =
    Array.isArray(wallet.signersAddresses) && wallet.signersAddresses.includes(requester);
  const isOwner = wallet.ownerAddress === requester || wallet.ownerAddress === "all";
  if (!isSigner && !isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this wallet" });
  }
  return wallet;
};

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
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      return ctx.db.signable.create({
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
      return ctx.db.signable.update({
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
      return ctx.db.signable.delete({
        where: {
          id: input.signableId,
        },
      });
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
