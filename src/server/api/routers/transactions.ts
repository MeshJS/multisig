import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

const getSessionAddresses = (ctx: any): string[] => {
  const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
  if (Array.isArray(sessionWallets) && sessionWallets.length > 0) {
    return sessionWallets;
  }
  const single = ctx.session?.user?.id ?? ctx.sessionAddress;
  return single ? [single] : [];
};

const assertWalletAccess = async (ctx: any, walletId: string) => {
  const wallet = await ctx.db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }

  const addresses = getSessionAddresses(ctx);
  if (addresses.length === 0) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const authorized = addresses.some((addr) => {
    const isSigner =
      Array.isArray(wallet.signersAddresses) && wallet.signersAddresses.includes(addr);
    const isOwner = wallet.ownerAddress === addr || wallet.ownerAddress === "all";
    return isSigner || isOwner;
  });

  if (!authorized) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this wallet" });
  }

  return wallet;
};

export const transactionRouter = createTRPCRouter({
  createTransaction: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        txJson: z.string().min(1),
        signedAddresses: z.array(z.string()),
        txCbor: z.string().min(1),
        state: z.number(),
        description: z.string().optional(),
        txHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      return ctx.db.transaction.create({
        data: {
          walletId: input.walletId,
          txJson: input.txJson,
          signedAddresses: input.signedAddresses,
          txCbor: input.txCbor,
          state: input.state,
          description: input.description,
          txHash: input.txHash,
        },
      });
    }),

  updateTransaction: protectedProcedure
    .input(
      z.object({
        transactionId: z.string(),
        signedAddresses: z.array(z.string()),
        rejectedAddresses: z.array(z.string()),
        txCbor: z.string().min(1),
        state: z.number(),
        txHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tx = await ctx.db.transaction.findUnique({ where: { id: input.transactionId } });
      if (!tx) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
      }
      await assertWalletAccess(ctx, tx.walletId);
      return ctx.db.transaction.update({
        where: {
          id: input.transactionId,
        },
        data: {
          signedAddresses: input.signedAddresses,
          rejectedAddresses: input.rejectedAddresses,
          txCbor: input.txCbor,
          state: input.state,
          txHash: input.txHash,
        },
      });
    }),

  deleteTransaction: protectedProcedure
    .input(z.object({ transactionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tx = await ctx.db.transaction.findUnique({ where: { id: input.transactionId } });
      if (!tx) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
      }
      await assertWalletAccess(ctx, tx.walletId);
      return ctx.db.transaction.delete({
        where: {
          id: input.transactionId,
        },
      });
    }),

  // Read-only queries require authenticated session whose address is a signer/owner
  getAllTransactions: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      return await ctx.db.transaction.findMany({
        where: {
          walletId: input.walletId,
          state: 1,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),

  getPendingTransactions: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      return await ctx.db.transaction.findMany({
        where: {
          walletId: input.walletId,
          state: 0,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),
});
