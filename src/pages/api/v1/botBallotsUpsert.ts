import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import {
  applyRateLimit,
  applyBotRateLimit,
  applyAddressRateLimit,
  enforceBodySize,
} from "@/lib/security/requestGuards";
import { getClientIP } from "@/lib/security/rateLimit";
import { parseScope, scopeIncludes, type BotScope } from "@/lib/auth/botKey";
import { assertBotWalletAccess, BotAccessError } from "@/lib/auth/botAccess";
import { assertWalletAccess } from "@/server/api/auth";
import { isValidChoice, parseProposalId } from "@/lib/governance";
import { addressToNetwork } from "@/utils/multisigSDK";

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

const TX_HASH_RE = /^[0-9a-f]{64}$/i;

/**
 * On-chain existence probe for a governance action. Returns false only on a
 * definitive 404; null when the provider can't answer (missing key, outage,
 * rate limit) so callers can fail open — an indexer hiccup shouldn't block
 * advisory drafts.
 */
async function proposalExistsOnChain(
  network: number,
  txHash: string,
  certIndex: number,
): Promise<boolean | null> {
  const key =
    network === 0
      ? process.env.BLOCKFROST_API_KEY_PREPROD || process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD
      : process.env.BLOCKFROST_API_KEY_MAINNET || process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET;
  if (!key?.trim()) return null;
  const base =
    network === 0
      ? "https://cardano-preprod.blockfrost.io/api/v0"
      : "https://cardano-mainnet.blockfrost.io/api/v0";
  try {
    const res = await fetch(`${base}/governance/proposals/${txHash}/${certIndex}`, {
      headers: { project_id: key, accept: "application/json" },
    });
    if (res.status === 404) return false;
    if (!res.ok) return null;
    return true;
  } catch {
    return null;
  }
}

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
    return res.status(401).json({ error: "Unauthorized - Missing or malformed Authorization header (expected: Bearer <token>)" });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  // Bots keep the scope gate and per-bot budget they always had. Humans are
  // allowed through because a wallet signer can already create and edit ballots
  // freely through the app's own tRPC router (see the wallet-access branch
  // below) — refusing them here would only mean the UI can do something the API
  // cannot, not that anything is safer.
  if (isBotJwt(payload)) {
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
  } else if (!applyAddressRateLimit(req, res, payload.address)) {
    return;
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

  let accessWallet: { signersAddresses: string[] } | null = null;
  try {
    if (isBotJwt(payload)) {
      // Non-mutating access: ballot drafts are unsigned advisory rows (choice +
      // rationaleComment only — anchors are rejected below), so an observer
      // grant is enough. Cosigner-for-drafts would lock advisory bots out of
      // existing wallets entirely, since signer lists are fixed at creation.
      // The ballot:write scope (owner-approved at claim) still gates this.
      ({ wallet: accessWallet } = await assertBotWalletAccess(db, walletId, payload, false));
    } else {
      // Humans get exactly the authorization every ballot procedure in
      // src/server/api/routers/ballot.ts applies: signer OR owner. Reusing the
      // canonical predicate rather than re-deriving it keeps the REST and tRPC
      // paths from drifting apart. Note this accepts a non-signer owner, which
      // the signer-only v1 helpers (proxyAccess, v1WalletAuth) would reject —
      // matching the app's own behaviour is the right call for ballots.
      accessWallet = await assertWalletAccess(
        {
          db,
          session: null,
          sessionAddress: payload.address,
          sessionWallets: [payload.address],
          primaryWallet: payload.address,
          ip: getClientIP(req),
        },
        walletId,
      );
    }
  } catch (err) {
    if (err instanceof BotAccessError) {
      return res.status(err.status).json({ error: err.message });
    }
    const code = (err as { code?: string })?.code;
    if (code === "NOT_FOUND") {
      return res.status(404).json({ error: "Wallet not found" });
    }
    return res
      .status(403)
      .json({ error: err instanceof Error ? err.message : "Not authorized for this wallet" });
  }

  const parsedProposals = new Map<string, { txHash: string; certIndex: number }>();
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
      const parsed = parseProposalId(proposal.proposalId);
      if (!TX_HASH_RE.test(parsed.txHash)) {
        return res.status(400).json({
          error: "Invalid proposalId: txHash must be a 64-character hex transaction hash",
          proposalId: proposal.proposalId,
        });
      }
      parsedProposals.set(proposal.proposalId, parsed);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Invalid proposalId",
        proposalId: proposal.proposalId,
      });
    }
  }

  // Existence check: a typo'd or stale proposalId would otherwise silently
  // create an advisory ballot for a phantom action. Definitive on-chain 404s
  // are rejected; provider outages fail open.
  const ballotNetwork = addressToNetwork(accessWallet?.signersAddresses?.[0] ?? "addr1");
  const existence = await Promise.all(
    Array.from(parsedProposals.entries()).map(async ([proposalId, parsed]) => ({
      proposalId,
      exists: await proposalExistsOnChain(ballotNetwork, parsed.txHash, parsed.certIndex),
    })),
  );
  const unknownProposalIds = existence.filter((e) => e.exists === false).map((e) => e.proposalId);
  if (unknownProposalIds.length > 0) {
    return res.status(400).json({
      error: "Unknown governance proposal(s): not found on-chain",
      proposalIds: unknownProposalIds,
    });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      let targetBallot: any | null = null;
      let createdBallot = false;

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
          createdBallot = true;
        }
      } else {
        targetBallot = await tx.ballot.create({
          data: {
            walletId,
            description: makeDefaultBallotName(),
            type: GOV_BALLOT_TYPE,
          },
        });
        createdBallot = true;
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
      return latest ? { latest, createdBallot } : null;
    });

    if (!result) {
      return res.status(500).json({ error: "Failed to save ballot" });
    }
    const { latest: savedBallot, createdBallot } = result;

    return res.status(200).json({
      // Whether this call created the ballot (vs updated an existing one) —
      // upserts are keyed on ballotId first, then exact ballotName match.
      created: createdBallot,
      ballot: {
        id: savedBallot.id,
        walletId: savedBallot.walletId,
        description: savedBallot.description,
        type: savedBallot.type,
        items: savedBallot.items,
        itemDescriptions: savedBallot.itemDescriptions,
        choices: savedBallot.choices,
        anchorUrls: (result as any).anchorUrls ?? [],
        anchorHashes: (result as any).anchorHashes ?? [],
        rationaleComments: (result as any).rationaleComments ?? [],
        createdAt: savedBallot.createdAt,
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
