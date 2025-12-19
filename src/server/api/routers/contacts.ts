import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

const getSessionAddresses = (ctx: any): string[] => {
  const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
  if (sessionWallets.length > 0) return sessionWallets;
  const single = ctx.sessionAddress;
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

export const contactRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      return await ctx.db.contact.findMany({
        where: {
          walletId: input.walletId,
        },
        orderBy: {
          name: "asc",
        },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        name: z.string().min(1, "Name is required"),
        address: z.string().min(1, "Address is required"),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      return await ctx.db.contact.create({
        data: {
          walletId: input.walletId,
          name: input.name,
          address: input.address,
          description: input.description,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1, "Name is required").optional(),
        address: z.string().min(1, "Address is required").optional(),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      // Verify ownership through wallet access
      const contact = await ctx.db.contact.findUnique({
        where: { id },
      });

      if (!contact) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contact not found",
        });
      }

      await assertWalletAccess(ctx, contact.walletId);

      return await ctx.db.contact.update({
        where: { id },
        data: updateData,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership through wallet access
      const contact = await ctx.db.contact.findUnique({
        where: { id: input.id },
      });

      if (!contact) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contact not found",
        });
      }

      await assertWalletAccess(ctx, contact.walletId);

      return await ctx.db.contact.delete({
        where: { id: input.id },
      });
    }),

  getByAddress: protectedProcedure
    .input(z.object({ walletId: z.string(), address: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      return await ctx.db.contact.findFirst({
        where: {
          walletId: input.walletId,
          address: input.address,
        },
      });
    }),
});

