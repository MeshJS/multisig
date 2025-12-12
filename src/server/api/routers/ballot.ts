import { useMemo } from "react";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const ballotRouter = createTRPCRouter({
  create: publicProcedure
    .input(
      z.object({
        walletId: z.string(),
        description: z.string(),
        type: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.ballot.create({
        data: {
          walletId: input.walletId,
          description: input.description,
          type: input.type,
        },
      });
    }),

  updateBallot: publicProcedure
    .input(
      z.object({
        ballotId: z.string(),
        description: z.string().optional(),
        items: z.array(z.string()),
        itemDescriptions: z.array(z.string()),
        choices: z.array(z.string()),
        type: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.ballot.update({
        where: {
          id: input.ballotId,
        },
        data: {
          description: input.description,
          items: input.items,
          itemDescriptions: input.itemDescriptions,
          choices: input.choices,
          type: input.type,
        },
      });
    }),

  delete: publicProcedure
    .input(z.object({ ballotId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.ballot.delete({
        where: {
          id: input.ballotId,
        },
      });
    }),

  getByWallet: publicProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.ballot.findMany({
        where: {
          walletId: input.walletId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),

  addProposalToBallot: publicProcedure
    .input(
      z.object({
        ballotId: z.string(),
        itemDescription: z.string(),
        item: z.string(),
        choice: z.string(),
        anchorUrl: z.string().optional(),
        anchorHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Find the ballot
      const ballot = await ctx.db.ballot.findUnique({
        where: { id: input.ballotId },
      });
      if (!ballot) {
        throw new Error("Ballot not found");
      }
      // Check if proposal already exists to prevent duplicates
      if (Array.isArray(ballot.items) && ballot.items.includes(input.item)) {
        throw new Error("Proposal already exists in this ballot");
      }
      // Append to arrays, initialize if undefined
      const updatedItems = Array.isArray(ballot.items) ? [...ballot.items, input.item] : [input.item];
      const updatedItemDescriptions = Array.isArray(ballot.itemDescriptions)
        ? [...ballot.itemDescriptions, input.itemDescription]
        : [input.itemDescription];
      const updatedChoices = Array.isArray(ballot.choices) ? [...ballot.choices, input.choice] : [input.choice];
      const ballotWithAnchors = ballot as typeof ballot & { anchorUrls?: string[]; anchorHashes?: string[] };
      const updatedAnchorUrls = Array.isArray(ballotWithAnchors.anchorUrls) 
        ? [...ballotWithAnchors.anchorUrls, input.anchorUrl || ""]
        : [input.anchorUrl || ""];
      const updatedAnchorHashes = Array.isArray(ballotWithAnchors.anchorHashes)
        ? [...ballotWithAnchors.anchorHashes, input.anchorHash || ""]
        : [input.anchorHash || ""];
      return ctx.db.ballot.update({
        where: { id: input.ballotId },
        data: {
          items: updatedItems,
          itemDescriptions: updatedItemDescriptions,
          choices: updatedChoices,
          anchorUrls: updatedAnchorUrls,
          anchorHashes: updatedAnchorHashes,
        } as any,
      });
    }),
      removeProposalFromBallot: publicProcedure
    .input(
      z.object({
        ballotId: z.string(),
        index: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Find the ballot
      const ballot = await ctx.db.ballot.findUnique({
        where: { id: input.ballotId },
      });
      if (!ballot) {
        throw new Error("Ballot not found");
      }
      // Remove the item at the given index from all arrays
      const ballotWithAnchors = ballot as typeof ballot & { anchorUrls?: string[]; anchorHashes?: string[] };
      const updatedItems = Array.isArray(ballot.items)
        ? ballot.items.filter((_, i) => i !== input.index)
        : [];
      const updatedItemDescriptions = Array.isArray(ballot.itemDescriptions)
        ? ballot.itemDescriptions.filter((_, i) => i !== input.index)
        : [];
      const updatedChoices = Array.isArray(ballot.choices)
        ? ballot.choices.filter((_, i) => i !== input.index)
        : [];
      const updatedAnchorUrls = Array.isArray(ballotWithAnchors.anchorUrls)
        ? ballotWithAnchors.anchorUrls.filter((_: string, i: number) => i !== input.index)
        : [];
      const updatedAnchorHashes = Array.isArray(ballotWithAnchors.anchorHashes)
        ? ballotWithAnchors.anchorHashes.filter((_: string, i: number) => i !== input.index)
        : [];
      return ctx.db.ballot.update({
        where: { id: input.ballotId },
        data: {
          items: updatedItems,
          itemDescriptions: updatedItemDescriptions,
          choices: updatedChoices,
          anchorUrls: updatedAnchorUrls,
          anchorHashes: updatedAnchorHashes,
        } as any,
      });
    }),

  updateChoice: publicProcedure
    .input(
      z.object({
        ballotId: z.string(),
        index: z.number(),
        choice: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ballot = await ctx.db.ballot.findUnique({
        where: { id: input.ballotId },
      });
      if (!ballot) throw new Error("Ballot not found");
      if (!Array.isArray(ballot.choices) || ballot.choices.length <= input.index)
        throw new Error("Invalid choice index");
      const updatedChoices = [...ballot.choices];
      updatedChoices[input.index] = input.choice;
      return ctx.db.ballot.update({
        where: { id: input.ballotId },
        data: { choices: updatedChoices },
      });
    }),

  updateProposalAnchor: publicProcedure
    .input(
      z.object({
        ballotId: z.string(),
        index: z.number(),
        anchorUrl: z.string().optional(),
        anchorHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ballot = await ctx.db.ballot.findUnique({
        where: { id: input.ballotId },
      });
      if (!ballot) throw new Error("Ballot not found");
      if (!Array.isArray(ballot.items) || ballot.items.length <= input.index)
        throw new Error("Invalid proposal index");
      
      const ballotWithAnchors = ballot as any;
      const updatedAnchorUrls = Array.isArray(ballotWithAnchors.anchorUrls) 
        ? [...ballotWithAnchors.anchorUrls]
        : Array(ballot.items.length).fill("");
      const updatedAnchorHashes = Array.isArray(ballotWithAnchors.anchorHashes)
        ? [...ballotWithAnchors.anchorHashes]
        : Array(ballot.items.length).fill("");
      
      // Ensure arrays are the right length
      while (updatedAnchorUrls.length < ballot.items.length) {
        updatedAnchorUrls.push("");
      }
      while (updatedAnchorHashes.length < ballot.items.length) {
        updatedAnchorHashes.push("");
      }
      
      updatedAnchorUrls[input.index] = input.anchorUrl || "";
      updatedAnchorHashes[input.index] = input.anchorHash || "";
      
      return ctx.db.ballot.update({
        where: { id: input.ballotId },
        data: {
          anchorUrls: updatedAnchorUrls,
          anchorHashes: updatedAnchorHashes,
        } as any,
      });
    }),
});