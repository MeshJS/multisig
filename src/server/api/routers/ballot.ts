import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { isValidChoice } from "@/lib/governance";

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

type BallotArrays = {
  items: string[];
  itemDescriptions: string[];
  choices: string[];
  anchorUrls: string[];
  anchorHashes: string[];
  rationaleComments: string[];
};

const ensureStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const alignBallotArrays = (
  arrays: Partial<BallotArrays>,
  targetLength?: number,
): BallotArrays => {
  const items = ensureStringArray(arrays.items);
  const length = typeof targetLength === "number" ? targetLength : items.length;
  const toLength = (arr: unknown, fill: string) => {
    const next = ensureStringArray(arr).slice(0, length);
    while (next.length < length) next.push(fill);
    return next;
  };

  return {
    items: items.slice(0, length),
    itemDescriptions: toLength(arrays.itemDescriptions, ""),
    choices: toLength(arrays.choices, "Abstain"),
    anchorUrls: toLength(arrays.anchorUrls, ""),
    anchorHashes: toLength(arrays.anchorHashes, ""),
    rationaleComments: toLength(arrays.rationaleComments, ""),
  };
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
      await assertWalletAccess(ctx, input.walletId);
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
        anchorUrls: z.array(z.string()).optional(),
        anchorHashes: z.array(z.string()).optional(),
        rationaleComments: z.array(z.string()).optional(),
        type: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ballot = await ctx.db.ballot.findUnique({ where: { id: input.ballotId } });
      if (!ballot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ballot not found" });
      }
      await assertWalletAccess(ctx, ballot.walletId);
      const existingAligned = alignBallotArrays(ballot as any);
      const aligned = alignBallotArrays(
        {
          items: input.items,
          itemDescriptions: input.itemDescriptions,
          choices: input.choices.map((choice) => (isValidChoice(choice) ? choice : "Abstain")),
          anchorUrls: input.anchorUrls ?? existingAligned.anchorUrls,
          anchorHashes: input.anchorHashes ?? existingAligned.anchorHashes,
          rationaleComments: input.rationaleComments ?? existingAligned.rationaleComments,
        },
        input.items.length,
      );

      return ctx.db.ballot.update({
        where: {
          id: input.ballotId,
        },
        data: {
          description: input.description,
          items: aligned.items,
          itemDescriptions: aligned.itemDescriptions,
          choices: aligned.choices,
          anchorUrls: aligned.anchorUrls,
          anchorHashes: aligned.anchorHashes,
          rationaleComments: aligned.rationaleComments,
          type: input.type,
        } as any,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ ballotId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ballot = await ctx.db.ballot.findUnique({ where: { id: input.ballotId } });
      if (!ballot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ballot not found" });
      }
      await assertWalletAccess(ctx, ballot.walletId);
      return ctx.db.ballot.delete({
        where: {
          id: input.ballotId,
        },
      });
    }),

  getByWallet: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
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
        rationaleComment: z.string().optional(),
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
      await assertWalletAccess(ctx, ballot.walletId);
      // Check if proposal already exists to prevent duplicates
      if (Array.isArray(ballot.items) && ballot.items.includes(input.item)) {
        throw new Error("Proposal already exists in this ballot");
      }
      const aligned = alignBallotArrays(ballot as any);
      const updatedItems = [...aligned.items, input.item];
      const updatedItemDescriptions = [...aligned.itemDescriptions, input.itemDescription];
      const updatedChoices = [
        ...aligned.choices,
        isValidChoice(input.choice) ? input.choice : "Abstain",
      ];
      const updatedAnchorUrls = [...aligned.anchorUrls, input.anchorUrl || ""];
      const updatedAnchorHashes = [...aligned.anchorHashes, input.anchorHash || ""];
      const updatedRationaleComments = [
        ...aligned.rationaleComments,
        typeof input.rationaleComment === "string" ? input.rationaleComment : "",
      ];
      return ctx.db.ballot.update({
        where: { id: input.ballotId },
        data: {
          items: updatedItems,
          itemDescriptions: updatedItemDescriptions,
          choices: updatedChoices,
          anchorUrls: updatedAnchorUrls,
          anchorHashes: updatedAnchorHashes,
          rationaleComments: updatedRationaleComments,
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
      // Find the ballot
      const ballot = await ctx.db.ballot.findUnique({
        where: { id: input.ballotId },
      });
      if (!ballot) {
        throw new Error("Ballot not found");
      }
      await assertWalletAccess(ctx, ballot.walletId);
      // Remove the item at the given index from all arrays
      const aligned = alignBallotArrays(ballot as any);
      const updatedItems = aligned.items.filter((_, i) => i !== input.index);
      const updatedItemDescriptions = aligned.itemDescriptions.filter((_, i) => i !== input.index);
      const updatedChoices = aligned.choices.filter((_, i) => i !== input.index);
      const updatedAnchorUrls = aligned.anchorUrls.filter((_, i) => i !== input.index);
      const updatedAnchorHashes = aligned.anchorHashes.filter((_, i) => i !== input.index);
      const updatedRationaleComments = aligned.rationaleComments.filter((_, i) => i !== input.index);
      return ctx.db.ballot.update({
        where: { id: input.ballotId },
        data: {
          items: updatedItems,
          itemDescriptions: updatedItemDescriptions,
          choices: updatedChoices,
          anchorUrls: updatedAnchorUrls,
          anchorHashes: updatedAnchorHashes,
          rationaleComments: updatedRationaleComments,
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
      const ballot = await ctx.db.ballot.findUnique({
        where: { id: input.ballotId },
      });
      if (!ballot) throw new Error("Ballot not found");
      const aligned = alignBallotArrays(ballot as any);
      if (!Array.isArray(aligned.choices) || aligned.choices.length <= input.index)
        throw new Error("Invalid choice index");
      await assertWalletAccess(ctx, ballot.walletId);
      const updatedChoices = [...aligned.choices];
      updatedChoices[input.index] = isValidChoice(input.choice) ? input.choice : "Abstain";
      return ctx.db.ballot.update({
        where: { id: input.ballotId },
        data: {
          choices: updatedChoices,
          itemDescriptions: aligned.itemDescriptions,
          anchorUrls: aligned.anchorUrls,
          anchorHashes: aligned.anchorHashes,
          rationaleComments: aligned.rationaleComments,
        } as any,
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
      const ballot = await ctx.db.ballot.findUnique({
        where: { id: input.ballotId },
      });
      if (!ballot) throw new Error("Ballot not found");
      const aligned = alignBallotArrays(ballot as any);
      if (!Array.isArray(aligned.items) || aligned.items.length <= input.index)
        throw new Error("Invalid proposal index");
      await assertWalletAccess(ctx, ballot.walletId);

      const updatedAnchorUrls = [...aligned.anchorUrls];
      const updatedAnchorHashes = [...aligned.anchorHashes];
      updatedAnchorUrls[input.index] = input.anchorUrl || "";
      updatedAnchorHashes[input.index] = input.anchorHash || "";

      return ctx.db.ballot.update({
        where: { id: input.ballotId },
        data: {
          itemDescriptions: aligned.itemDescriptions,
          choices: aligned.choices,
          anchorUrls: updatedAnchorUrls,
          anchorHashes: updatedAnchorHashes,
          rationaleComments: aligned.rationaleComments,
        } as any,
      });
    }),

  updateProposalRationale: protectedProcedure
    .input(
      z.object({
        ballotId: z.string(),
        index: z.number(),
        rationaleComment: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ballot = await ctx.db.ballot.findUnique({
        where: { id: input.ballotId },
      });
      if (!ballot) throw new Error("Ballot not found");
      const aligned = alignBallotArrays(ballot as any);
      if (!Array.isArray(aligned.items) || aligned.items.length <= input.index) {
        throw new Error("Invalid proposal index");
      }
      await assertWalletAccess(ctx, ballot.walletId);

      const updatedRationaleComments = [...aligned.rationaleComments];
      updatedRationaleComments[input.index] = input.rationaleComment;

      return ctx.db.ballot.update({
        where: { id: input.ballotId },
        data: {
          itemDescriptions: aligned.itemDescriptions,
          choices: aligned.choices,
          anchorUrls: aligned.anchorUrls,
          anchorHashes: aligned.anchorHashes,
          rationaleComments: updatedRationaleComments,
        } as any,
      });
    }),
});