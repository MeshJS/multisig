import { z } from "zod";
import { TRPCError } from "@trpc/server";
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

export const ballotRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        description: z.string().max(2000),
        type: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      return ctx.db.ballot.create({
        data: {
          walletId: input.walletId,
          description: input.description,
          type: input.type,
        },
      });
    }),

  updateBallot: protectedProcedure
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
      const sessionAddress = requireSessionAddress(ctx);
      const ballot = await ctx.db.ballot.findUnique({ where: { id: input.ballotId } });
      if (!ballot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ballot not found" });
      }
      await assertWalletAccess(ctx, ballot.walletId, sessionAddress);
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

  delete: protectedProcedure
    .input(z.object({ ballotId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const ballot = await ctx.db.ballot.findUnique({ where: { id: input.ballotId } });
      if (!ballot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ballot not found" });
      }
      await assertWalletAccess(ctx, ballot.walletId, sessionAddress);
      return ctx.db.ballot.delete({
        where: {
          id: input.ballotId,
        },
      });
    }),

  getByWallet: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      return await ctx.db.ballot.findMany({
        where: {
          walletId: input.walletId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),

  addProposalToBallot: protectedProcedure
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
      const sessionAddress = requireSessionAddress(ctx);
      // Find the ballot
      const ballot = await ctx.db.ballot.findUnique({
        where: { id: input.ballotId },
      });
      if (!ballot) {
        throw new Error("Ballot not found");
      }
      await assertWalletAccess(ctx, ballot.walletId, sessionAddress);
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
      removeProposalFromBallot: protectedProcedure
    .input(
      z.object({
        ballotId: z.string(),
        index: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      // Find the ballot
      const ballot = await ctx.db.ballot.findUnique({
        where: { id: input.ballotId },
      });
      if (!ballot) {
        throw new Error("Ballot not found");
      }
      await assertWalletAccess(ctx, ballot.walletId, sessionAddress);
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

  updateChoice: protectedProcedure
    .input(
      z.object({
        ballotId: z.string(),
        index: z.number(),
        choice: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const ballot = await ctx.db.ballot.findUnique({
        where: { id: input.ballotId },
      });
      if (!ballot) throw new Error("Ballot not found");
      if (!Array.isArray(ballot.choices) || ballot.choices.length <= input.index)
        throw new Error("Invalid choice index");
      await assertWalletAccess(ctx, ballot.walletId, sessionAddress);
      const updatedChoices = [...ballot.choices];
      updatedChoices[input.index] = input.choice;
      return ctx.db.ballot.update({
        where: { id: input.ballotId },
        data: { choices: updatedChoices },
      });
    }),

  updateProposalAnchor: protectedProcedure
    .input(
      z.object({
        ballotId: z.string(),
        index: z.number(),
        anchorUrl: z.string().optional(),
        anchorHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const ballot = await ctx.db.ballot.findUnique({
        where: { id: input.ballotId },
      });
      if (!ballot) throw new Error("Ballot not found");
      if (!Array.isArray(ballot.items) || ballot.items.length <= input.index)
        throw new Error("Invalid proposal index");
      await assertWalletAccess(ctx, ballot.walletId, sessionAddress);
      
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