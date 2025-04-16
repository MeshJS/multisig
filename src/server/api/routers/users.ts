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
        nostrKey: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.create({
        data: {
          address: input.address,
          stakeAddress: input.stakeAddress,
          nostrKey: input.nostrKey,
        },
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
