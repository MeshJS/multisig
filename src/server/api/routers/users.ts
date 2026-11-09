import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/api/trpc";
import type { AuthCtx } from "@/server/api/trpc";

const requireSessionAddress = (ctx: AuthCtx) => {
  const address = ctx.session?.user?.id ?? ctx.sessionAddress;
  if (!address) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return address;
};

/**
 * Every address the caller has proven they control: the NextAuth user, the
 * primary wallet, and every wallet nonce-verified in this browser's session.
 * Empty for an anonymous caller.
 */
const callerAddresses = (ctx: AuthCtx): Set<string> => {
  const addresses = new Set<string>(ctx.sessionWallets ?? []);
  if (ctx.session?.user?.id) addresses.add(ctx.session.user.id);
  if (ctx.sessionAddress) addresses.add(ctx.sessionAddress);
  return addresses;
};

/**
 * The columns anyone may read for any address. Address and stake address are
 * on-chain; the DRep key hash is too once the user registers as a DRep, and
 * is derived from the same wallet keys either way. Columns that are not (the
 * linked Discord account, the Nostr key, and any column added later) stay
 * private until they are deliberately added here, because pairing a Cardano
 * address with an off-chain identity is exactly what a public lookup must not
 * hand out.
 */
const PUBLIC_USER_SELECT = {
  id: true,
  address: true,
  stakeAddress: true,
  drepKeyHash: true,
} as const;

export const userRouter = createTRPCRouter({
  // Public because the app reads it on connect, before the wallet session
  // cookie exists. The full row goes only to the address's own session;
  // everyone else gets the public columns, with the private ones blanked so
  // the response keeps one shape for the client.
  getUserByAddress: publicProcedure
    .input(z.object({ address: z.string().min(1, "address required") }))
    .query(async ({ ctx, input }) => {
      if (callerAddresses(ctx).has(input.address)) {
        return ctx.db.user.findUnique({
          where: { address: input.address },
        });
      }

      const user = await ctx.db.user.findUnique({
        where: { address: input.address },
        select: PUBLIC_USER_SELECT,
      });
      if (!user) return null;
      return { ...user, discordId: "", nostrKey: null };
    }),

  // Onboarding upsert. Authenticated only — the session address must match
  // the address being created/updated to prevent any unauthenticated caller
  // from creating User rows or overwriting another user's stake/drep keys.
  createUser: protectedProcedure
    .input(
      z.object({
        address: z.string().min(1, "address required"),
        stakeAddress: z.string().min(1, "stakeAddress required"),
        // DRep key hash is optional (not all wallets / networks expose it)
        drepKeyHash: z.string().optional().default(""),
        // nostrKey is legacy — the chat system that used it was removed
        // in #253; the column is nullable in the schema, callers no
        // longer pass it. Kept in the input shape for backwards
        // compatibility with any in-flight client bundles.
        nostrKey: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      // The wallet session accumulates every nonce-verified address in
      // this browser; any of them is "yourself". Requiring an exact match
      // on the primary (most recently authorized) address 403s users who
      // switched back to a previously authorized wallet.
      const sessionWallets: string[] = ctx.sessionWallets ?? [];
      const callerAddresses = new Set([sessionAddress, ...sessionWallets]);
      if (!callerAddresses.has(input.address)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot create or modify a user other than yourself",
        });
      }
      return ctx.db.user.upsert({
        where: {
          address: input.address,
        },
        update: {
          stakeAddress: input.stakeAddress,
          drepKeyHash: input.drepKeyHash,
          ...(input.nostrKey ? { nostrKey: input.nostrKey } : {}),
        },
        create: {
          address: input.address,
          stakeAddress: input.stakeAddress,
          drepKeyHash: input.drepKeyHash,
          ...(input.nostrKey ? { nostrKey: input.nostrKey } : {}),
        },
      });
    }),

  updateUser: protectedProcedure
    .input(
      z.object({
        address: z.string().min(1).optional(),
        stakeAddress: z.string().min(1).optional(),
        drepKeyHash: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const { address, stakeAddress, drepKeyHash } = input;

      if (!address && !stakeAddress && !drepKeyHash) {
        throw new Error("At least one of address, stakeAddress, or drepKeyHash must be provided.");
      }

      const user = await ctx.db.user.findFirst({
        where: {
          OR: [
            address ? { address } : undefined,
            stakeAddress ? { stakeAddress } : undefined,
            drepKeyHash ? { drepKeyHash } : undefined,
          ].filter(Boolean) as any,
        },
      });

      if (!user) {
        throw new Error("User not found.");
      }

      if (user.address !== sessionAddress) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not allowed to update this user" });
      }

      const data: Record<string, string> = {};
      if (address && address !== user.address) data.address = address;
      if (stakeAddress && stakeAddress !== user.stakeAddress) data.stakeAddress = stakeAddress;
      if (drepKeyHash && drepKeyHash !== user.drepKeyHash) data.drepKeyHash = drepKeyHash;

      if (Object.keys(data).length === 0) {
        throw new Error("No updatable fields provided.");
      }

      return ctx.db.user.update({
        where: { id: user.id },
        data,
      });
    }),

  unlinkDiscord: protectedProcedure
    .input(z.object({ address: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      if (sessionAddress !== input.address) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
      return await ctx.db.user.update({
        where: {
          address: input.address,
        },
        data: {
          discordId: "",
        },
      });
    }),

  getDiscordIds: protectedProcedure
    .input(
      z.object({
        addresses: z.array(z.string().min(1)).min(1).max(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const users = await ctx.db.user.findMany({
        where: {
          address: {
            in: input.addresses,
          },
        },
        select: {
          address: true,
          discordId: true,
        },
      });

      // Return as a map of address -> discordId
      return users.reduce(
        (acc, user) => {
          if (user.discordId) {
            acc[user.address] = user.discordId;
          }
          return acc;
        },
        {} as Record<string, string>,
      );
    }),

  // The caller's own linked Discord account (profile page, user menu, the
  // "link Discord" prompt on the signers card). Any other address answers
  // null, the same as "not linked": being signed in proves who you are, not
  // a right to look up who someone else is on Discord. (getDiscordIds, the
  // co-signer lookup, is still open to any session; scoping it to wallets
  // the caller shares is a separate change.)
  getUserDiscordId: protectedProcedure
    .input(z.object({ address: z.string().min(1, "address required") }))
    .query(async ({ ctx, input }) => {
      if (!callerAddresses(ctx).has(input.address)) {
        return null;
      }

      const user = await ctx.db.user.findUnique({
        where: {
          address: input.address,
        },
      });

      if (user) {
        return user.discordId;
      }

      return null;
    }),
});
