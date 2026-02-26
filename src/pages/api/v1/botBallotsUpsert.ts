import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, applyBotRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { parseScope, scopeIncludes, type BotScope } from "@/lib/auth/botKey";
import { assertBotWalletAccess } from "@/lib/auth/botAccess";
import { isValidChoice, parseProposalId } from "@/lib/governance";

const REQUIRED_SCOPE = "ballot:write";
const GOV_BALLOT_TYPE = 1;

type UpsertProposalInput = {
  proposalId: string;
  proposalTitle: string;
  choice: string;
  rationaleComment?: string;
  anchorUrl?: string;
  anchorHash?: string;
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

const alignBallotArrays = (ballot: any): BallotArrays => {
  const items = ensureStringArray(ballot?.items);
  const length = items.length;
  const toLength = (arr: unknown, fill: string) => {
    const next = ensureStringArray(arr).slice(0, length);
    while (next.length < length) next.push(fill);
    return next;
  };

  return {
    items,
    itemDescriptions: toLength(ballot?.itemDescriptions, ""),
    choices: toLength(ballot?.choices, "Abstain"),
    anchorUrls: toLength(ballot?.anchorUrls, ""),
    anchorHashes: toLength(ballot?.anchorHashes, ""),
    rationaleComments: toLength(ballot?.rationaleComments, ""),
  };
};

const makeDefaultBallotName = (): string => {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `Bot ballot - ${yyyy}-${mm}-${dd}`;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);
  if (!applyRateLimit(req, res, { keySuffix: "v1/botBallotsUpsert" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!enforceBodySize(req, res, 100 * 1024)) {
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized - Missing token" });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  if (!isBotJwt(payload)) {
    return res.status(403).json({ error: "Only bot tokens can access this endpoint" });
  }
  if (!applyBotRateLimit(req, res, payload.botId)) {
    return;
  }

  const botUser = await db.botUser.findUnique({
    where: { id: payload.botId },
    include: { botKey: true },
  });
  if (!botUser?.botKey) {
    return res.status(401).json({ error: "Bot not found" });
  }
  const scopes = parseScope(botUser.botKey.scope);
  if (!scopeIncludes(scopes, REQUIRED_SCOPE as BotScope)) {
    return res.status(403).json({ error: "Insufficient scope: ballot:write required" });
  }

  const walletId = typeof req.body?.walletId === "string" ? req.body.walletId : "";
  const ballotId = typeof req.body?.ballotId === "string" ? req.body.ballotId : undefined;
  const ballotName = typeof req.body?.ballotName === "string" ? req.body.ballotName : undefined;
  const proposals = Array.isArray(req.body?.proposals)
    ? (req.body.proposals as UpsertProposalInput[])
    : null;

  if (!walletId) {
    return res.status(400).json({ error: "walletId is required" });
  }
  if (!proposals || proposals.length === 0) {
    return res.status(400).json({ error: "proposals must be a non-empty array" });
  }

  try {
    await assertBotWalletAccess(db, walletId, payload, true);
  } catch (err) {
    return res
      .status(403)
      .json({ error: err instanceof Error ? err.message : "Not authorized for this wallet" });
  }

  for (const proposal of proposals) {
    if (typeof proposal?.proposalId !== "string" || typeof proposal?.proposalTitle !== "string") {
      return res.status(400).json({ error: "Each proposal requires proposalId and proposalTitle" });
    }
    if (typeof proposal?.choice !== "string" || !isValidChoice(proposal.choice)) {
      return res.status(400).json({ error: "Each proposal choice must be Yes, No, or Abstain" });
    }
    if ("anchorUrl" in proposal || "anchorHash" in proposal) {
      return res
        .status(400)
        .json({ error: "Bots cannot set anchorUrl or anchorHash directly; provide rationaleComment only" });
    }
    try {
      parseProposalId(proposal.proposalId);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Invalid proposalId",
      });
    }
  }

  try {
    const result = await db.$transaction(async (tx) => {
      let targetBallot: any | null = null;

      if (ballotId) {
        targetBallot = await tx.ballot.findUnique({ where: { id: ballotId } });
        if (!targetBallot) {
          throw new Error("BALLOT_NOT_FOUND");
        }
        if (targetBallot.walletId !== walletId) {
          throw new Error("BALLOT_WALLET_MISMATCH");
        }
        if (targetBallot.type !== GOV_BALLOT_TYPE) {
          throw new Error("BALLOT_TYPE_INVALID");
        }
      } else if (ballotName) {
        const matches = await tx.ballot.findMany({
          where: {
            walletId,
            type: GOV_BALLOT_TYPE,
            description: ballotName,
          },
          orderBy: { createdAt: "desc" },
        });

        if (matches.length > 1) {
          throw new Error("BALLOT_NAME_AMBIGUOUS");
        }

        if (matches.length === 1) {
          targetBallot = matches[0];
        } else {
          targetBallot = await tx.ballot.create({
            data: {
              walletId,
              description: ballotName,
              type: GOV_BALLOT_TYPE,
            },
          });
        }
      } else {
        targetBallot = await tx.ballot.create({
          data: {
            walletId,
            description: makeDefaultBallotName(),
            type: GOV_BALLOT_TYPE,
          },
        });
      }

      const baselineUpdatedAt = targetBallot.updatedAt as Date;
      const aligned = alignBallotArrays(targetBallot);

      for (const proposal of proposals) {
        const existingIndex = aligned.items.findIndex((item) => item === proposal.proposalId);
        if (existingIndex >= 0) {
          aligned.itemDescriptions[existingIndex] =
            proposal.proposalTitle || aligned.itemDescriptions[existingIndex] || "";
          aligned.choices[existingIndex] = proposal.choice;
          if (typeof proposal.rationaleComment === "string") {
            aligned.rationaleComments[existingIndex] = proposal.rationaleComment;
          }
        } else {
          aligned.items.push(proposal.proposalId);
          aligned.itemDescriptions.push(proposal.proposalTitle || proposal.proposalId);
          aligned.choices.push(proposal.choice);
          aligned.anchorUrls.push("");
          aligned.anchorHashes.push("");
          aligned.rationaleComments.push(
            typeof proposal.rationaleComment === "string" ? proposal.rationaleComment : "",
          );
        }
      }

      const updated = await tx.ballot.updateMany({
        where: {
          id: targetBallot.id,
          updatedAt: baselineUpdatedAt,
        },
        data: {
          items: aligned.items,
          itemDescriptions: aligned.itemDescriptions,
          choices: aligned.choices,
          anchorUrls: aligned.anchorUrls,
          anchorHashes: aligned.anchorHashes,
          rationaleComments: aligned.rationaleComments,
        } as any,
      } as any);

      if (updated.count !== 1) {
        throw new Error("BALLOT_WRITE_CONFLICT");
      }

      const latest = await tx.ballot.findUnique({ where: { id: targetBallot.id } });
      return latest;
    });

    if (!result) {
      return res.status(500).json({ error: "Failed to save ballot" });
    }

    return res.status(200).json({
      ballot: {
        id: result.id,
        walletId: result.walletId,
        description: result.description,
        type: result.type,
        items: result.items,
        itemDescriptions: result.itemDescriptions,
        choices: result.choices,
        anchorUrls: (result as any).anchorUrls ?? [],
        anchorHashes: (result as any).anchorHashes ?? [],
        rationaleComments: (result as any).rationaleComments ?? [],
        createdAt: result.createdAt,
        updatedAt: (result as any).updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "BALLOT_NOT_FOUND") {
      return res.status(404).json({ error: "Ballot not found" });
    }
    if (error instanceof Error && error.message === "BALLOT_WALLET_MISMATCH") {
      return res.status(403).json({ error: "ballotId does not belong to walletId" });
    }
    if (error instanceof Error && error.message === "BALLOT_TYPE_INVALID") {
      return res.status(400).json({ error: "Only governance ballots (type=1) can be updated" });
    }
    if (error instanceof Error && error.message === "BALLOT_NAME_AMBIGUOUS") {
      return res
        .status(409)
        .json({ error: "Multiple ballots match ballotName; provide ballotId to disambiguate" });
    }
    if (error instanceof Error && error.message === "BALLOT_WRITE_CONFLICT") {
      return res
        .status(409)
        .json({ error: "Ballot changed concurrently. Retry with the latest ballot state." });
    }
    console.error("botBallotsUpsert error:", error);
    return res.status(500).json({ error: "Failed to upsert bot ballot" });
  }
}
