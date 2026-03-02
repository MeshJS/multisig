import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { hashBotKeySecret, generateBotKeySecret, BOT_SCOPES, parseScope } from "@/lib/auth/botKey";
import { BotWalletRole } from "@prisma/client";

function requireSessionAddress(ctx: unknown): string {
  const c = ctx as { session?: { user?: { id?: string } } | null; sessionAddress?: string | null };
  const address = c.session?.user?.id ?? c.sessionAddress;
  if (!address) throw new TRPCError({ code: "UNAUTHORIZED" });
  return address;
}

export const botRouter = createTRPCRouter({
  createBotKey: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(256),
        scope: z.array(z.enum(BOT_SCOPES as unknown as [string, ...string[]])).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ownerAddress = requireSessionAddress(ctx);
      const secret = generateBotKeySecret();
      const keyHash = hashBotKeySecret(secret);
      const scopeJson = JSON.stringify(input.scope);

      const botKey = await ctx.db.botKey.create({
        data: {
          ownerAddress,
          name: input.name,
          keyHash,
          scope: scopeJson,
        },
      });

      return { botKeyId: botKey.id, secret, name: botKey.name };
    }),

  listBotKeys: protectedProcedure.input(z.object({})).query(async ({ ctx }) => {
    const ownerAddress = requireSessionAddress(ctx);
    const botKeys = await ctx.db.botKey.findMany({
      where: { ownerAddress },
      include: { botUser: true },
      orderBy: { createdAt: "desc" },
    });
    return botKeys.map((botKey) => ({
      ...botKey,
      scopes: parseScope(botKey.scope),
    }));
  }),

  updateBotKeyScopes: protectedProcedure
    .input(
      z.object({
        botKeyId: z.string(),
        scope: z.array(z.enum(BOT_SCOPES as unknown as [string, ...string[]])).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ownerAddress = requireSessionAddress(ctx);
      const botKey = await ctx.db.botKey.findUnique({ where: { id: input.botKeyId } });
      if (!botKey) throw new TRPCError({ code: "NOT_FOUND", message: "Bot key not found" });
      if (botKey.ownerAddress !== ownerAddress) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not the owner of this bot key" });
      }
      await ctx.db.botKey.update({
        where: { id: input.botKeyId },
        data: { scope: JSON.stringify(input.scope) },
      });
      return { ok: true };
    }),

  revokeBotKey: protectedProcedure
    .input(z.object({ botKeyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ownerAddress = requireSessionAddress(ctx);
      const botKey = await ctx.db.botKey.findUnique({ where: { id: input.botKeyId } });
      if (!botKey) throw new TRPCError({ code: "NOT_FOUND", message: "Bot key not found" });
      if (botKey.ownerAddress !== ownerAddress) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not the owner of this bot key" });
      }
      await ctx.db.botKey.delete({ where: { id: input.botKeyId } });
      return { ok: true };
    }),

  grantBotAccess: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        botId: z.string(),
        role: z.nativeEnum(BotWalletRole),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const requester = requireSessionAddress(ctx);
      const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
      const allRequesters = [requester, ...sessionWallets];

      const wallet = await ctx.db.wallet.findUnique({ where: { id: input.walletId } });
      if (!wallet) throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
      const ownerAddress = wallet.ownerAddress ?? null;
      const isOwner =
        ownerAddress !== null &&
        (ownerAddress === "all" || allRequesters.includes(ownerAddress));
      if (!isOwner) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the wallet owner can grant bot access" });
      }

      const botUser = await ctx.db.botUser.findUnique({ where: { id: input.botId } });
      if (!botUser) throw new TRPCError({ code: "NOT_FOUND", message: "Bot not found" });

      await ctx.db.walletBotAccess.upsert({
        where: {
          walletId_botId: { walletId: input.walletId, botId: input.botId },
        },
        update: { role: input.role },
        create: {
          walletId: input.walletId,
          botId: input.botId,
          role: input.role,
        },
      });
      return { ok: true };
    }),

  revokeBotAccess: protectedProcedure
    .input(z.object({ walletId: z.string(), botId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const requester = requireSessionAddress(ctx);
      const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
      const wallet = await ctx.db.wallet.findUnique({ where: { id: input.walletId } });
      if (!wallet) throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
      const ownerAddress = wallet.ownerAddress ?? null;
      const isOwner =
        ownerAddress !== null &&
        (ownerAddress === "all" || ownerAddress === requester || sessionWallets.includes(ownerAddress));
      if (!isOwner) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the wallet owner can revoke bot access" });
      }
      await ctx.db.walletBotAccess.deleteMany({
        where: { walletId: input.walletId, botId: input.botId },
      });
      return { ok: true };
    }),

  listWalletBotAccess: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      const requester = requireSessionAddress(ctx);
      const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
      const wallet = await ctx.db.wallet.findUnique({ where: { id: input.walletId } });
      if (!wallet) throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
      const ownerAddress = wallet.ownerAddress ?? null;
      const isOwner =
        ownerAddress !== null &&
        (ownerAddress === "all" || ownerAddress === requester || sessionWallets.includes(ownerAddress));
      if (!isOwner) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the wallet owner can list bot access" });
      }
      return ctx.db.walletBotAccess.findMany({
        where: { walletId: input.walletId },
      });
    }),
});
