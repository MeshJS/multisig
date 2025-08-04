import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const userRouter = createTRPCRouter({
  getUserByAddress: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.user.findUnique({
        where: {
          address: input.address,
        },
      });
    }),

  createUser: publicProcedure
    .input(
      z.object({
        address: z.string(),
        stakeAddress: z.string(),
        drepKeyHash: z.string(),
        nostrKey: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.create({
        data: {
          address: input.address,
          stakeAddress: input.stakeAddress,
          drepKeyHash: input.drepKeyHash,
          nostrKey: input.nostrKey,
        },
      });
    }),

  updateUser: publicProcedure
    .input(
      z.object({
        address: z.string().optional(),
        stakeAddress: z.string().optional(),
        drepKeyHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
    .input(z.object({ addresses: z.array(z.string()) }))
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

  unlinkDiscord: publicProcedure
    .input(z.object({ address: z.string() }))
    .mutation(async ({ ctx, input }) => {
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
        addresses: z.array(z.string()),
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
    .input(z.object({ address: z.string() }))
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
