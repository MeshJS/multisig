import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { BOT_SCOPES, parseScope, type BotScope } from "@/lib/auth/botKey";
import { ClaimError, performClaim } from "@/lib/auth/claimBot";
import { BotWalletRole } from "@prisma/client";

type SessionAddressContext = {
  session?: { user?: { id?: string } } | null;
  sessionAddress?: string | null;
  primaryWallet?: string | null;
  sessionWallets?: string[];
};

function requireSessionAddress(
  ctx: unknown,
  options?: {
    // Prefer the most recently wallet-authorized address for wallet-bound operations.
    preferWalletSession?: boolean;
    requireWalletSession?: boolean;
    logMismatchLabel?: string;
  },
): string {
  const c = ctx as SessionAddressContext;
  const nextAuthAddress = c.session?.user?.id ?? null;
  const firstSessionWallet = Array.isArray(c.sessionWallets) ? c.sessionWallets[0] : undefined;
  const walletSessionAddress = c.primaryWallet ?? firstSessionWallet ?? c.sessionAddress ?? null;

  if (options?.requireWalletSession && !walletSessionAddress) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Please authorize your active wallet before claiming a bot",
    });
  }

  const address = options?.preferWalletSession
    ? (walletSessionAddress ?? nextAuthAddress)
    : (nextAuthAddress ?? walletSessionAddress);

  if (
    options?.logMismatchLabel &&
    nextAuthAddress &&
    walletSessionAddress &&
    nextAuthAddress !== walletSessionAddress
  ) {
    console.warn(`[bot.${options.logMismatchLabel}] Address source mismatch`, {
      nextAuthAddress,
      walletSessionAddress,
      selectedAddress: address,
    });
  }

  if (!address) throw new TRPCError({ code: "UNAUTHORIZED" });
  return address;
}

export const botRouter = createTRPCRouter({
  listBotKeys: protectedProcedure.input(z.object({})).query(async ({ ctx }) => {
    const ownerAddress = requireSessionAddress(ctx, { preferWalletSession: true });
    const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
    const allRequesters = Array.from(new Set([ownerAddress, ...sessionWallets]));

    const botKeys = await ctx.db.botKey.findMany({
      where: { ownerAddress },
      include: { botUser: true },
      orderBy: { createdAt: "desc" },
    });

    const botIds = botKeys.map((botKey) => botKey.botUser?.id).filter((id): id is string => Boolean(id));

    if (botIds.length === 0) {
      return botKeys.map((botKey) => ({
        ...botKey,
        scopes: parseScope(botKey.scope),
        botWalletAccesses: [],
      }));
    }

    const ownedWallets = await ctx.db.wallet.findMany({
      where: {
        ownerAddress: {
          in: [...allRequesters, "all"],
        },
      },
      select: { id: true },
    });

    const walletIds = ownedWallets.map((wallet) => wallet.id);
    const walletAccesses = walletIds.length
      ? await ctx.db.walletBotAccess.findMany({
        where: {
          walletId: { in: walletIds },
          botId: { in: botIds },
        },
        select: {
          walletId: true,
          botId: true,
          role: true,
        },
      })
      : [];

    const accessByBotId = walletAccesses.reduce<Record<string, typeof walletAccesses>>((acc, access) => {
      const existing = acc[access.botId] ?? [];
      acc[access.botId] = [...existing, access];
      return acc;
    }, {});

    return botKeys.map((botKey) => ({
      ...botKey,
      scopes: parseScope(botKey.scope),
      botWalletAccesses: botKey.botUser ? (accessByBotId[botKey.botUser.id] ?? []) : [],
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
      const ownerAddress = requireSessionAddress(ctx, { preferWalletSession: true });
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
      const ownerAddress = requireSessionAddress(ctx, { preferWalletSession: true });
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
      const requester = requireSessionAddress(ctx, { preferWalletSession: true });
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

      if (
        input.role === BotWalletRole.cosigner &&
        !wallet.signersAddresses.includes(botUser.paymentAddress)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bot payment address must be in wallet signer list to grant cosigner role",
        });
      }

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
      const requester = requireSessionAddress(ctx, { preferWalletSession: true });
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
      const requester = requireSessionAddress(ctx, { preferWalletSession: true });
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

  lookupPendingBot: protectedProcedure
    .input(z.object({ pendingBotId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const pendingBot = await ctx.db.pendingBot.findUnique({
        where: { id: input.pendingBotId },
      });

      if (!pendingBot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bot not found or registration expired" });
      }

      if (pendingBot.expiresAt < new Date()) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bot registration has expired" });
      }

      return {
        name: pendingBot.name,
        paymentAddress: pendingBot.paymentAddress,
        requestedScopes: JSON.parse(pendingBot.requestedScopes) as string[],
        status: pendingBot.status,
      };
    }),

  claimBot: protectedProcedure
    .input(
      z.object({
        pendingBotId: z.string().min(1),
        claimCode: z.string().min(24),
        approvedScopes: z.array(z.enum(BOT_SCOPES as unknown as [string, ...string[]])),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ownerAddress = requireSessionAddress(ctx, {
        preferWalletSession: true,
        requireWalletSession: true,
        logMismatchLabel: "claimBot",
      });

      try {
        return await ctx.db.$transaction(async (tx) => {
          return performClaim(tx, {
            pendingBotId: input.pendingBotId,
            claimCode: input.claimCode,
            approvedScopes: input.approvedScopes as BotScope[],
            ownerAddress,
          });
        });
      } catch (err) {
        if (err instanceof ClaimError) {
          const codeMap: Record<string, "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST"> = {
            bot_not_found: "NOT_FOUND",
            bot_already_claimed: "CONFLICT",
            invalid_or_expired_claim_code: "CONFLICT",
            claim_locked_out: "CONFLICT",
            invalid_claim_payload: "BAD_REQUEST",
          };
          throw new TRPCError({
            code: codeMap[err.code] ?? "INTERNAL_SERVER_ERROR",
            message: err.code,
          });
        }
        throw err;
      }
    }),
});
