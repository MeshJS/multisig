import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/api/trpc";

const requireSessionAddress = (ctx: any) => {
  const address = ctx.session?.user?.id ?? ctx.sessionAddress;
  if (!address) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return address;
};

export const userRouter = createTRPCRouter({
  getUserByAddress: publicProcedure
    .input(z.object({ address: z.string().min(1, "address required") }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.user.findUnique({
        where: {
          address: input.address,
        },
      });
    }),

  // Keep createUser public for onboarding flows, but bind address when session exists
  createUser: publicProcedure
    .input(
      z.object({
        address: z.string().min(1, "address required"),
        stakeAddress: z.string().min(1, "stakeAddress required"),
        drepKeyHash: z.string().min(1, "drepKeyHash required"),
        nostrKey: z.string().min(1, "nostrKey required"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.upsert({
        where: {
          address: input.address,
        },
        update: {
          stakeAddress: input.stakeAddress,
          drepKeyHash: input.drepKeyHash,
          nostrKey: input.nostrKey,
        },
        create: {
          address: input.address,
          stakeAddress: input.stakeAddress,
          drepKeyHash: input.drepKeyHash,
          nostrKey: input.nostrKey,
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

  getNostrKeysByAddresses: publicProcedure
    .input(z.object({ addresses: z.array(z.string().min(1)).min(1) }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.user.findMany({
        where: {
          address: {
            in: input.addresses,
          },
        },
        select: {
          address: true,
          nostrKey: true,
        },
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

  getDiscordIds: publicProcedure
    .input(
      z.object({
        addresses: z.array(z.string().min(1)).min(1),
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

  getUserDiscordId: publicProcedure
    .input(z.object({ address: z.string().min(1, "address required") }))
    .query(async ({ ctx, input }) => {
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
