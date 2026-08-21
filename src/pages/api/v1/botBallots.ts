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
import { assertWalletAccess } from "@/server/api/auth";
import { parseScope, scopeIncludes, type BotScope } from "@/lib/auth/botKey";
import { assertBotWalletAccess, BotAccessError } from "@/lib/auth/botAccess";

const REQUIRED_SCOPE = "ballot:write";
const GOV_BALLOT_TYPE = 1;

/**
 * Read/delete side of the bot ballot-drafting lifecycle (upserts live in
 * botBallotsUpsert). GET lists the governance ballots on a granted wallet so
 * a bot can reconcile its drafts; DELETE removes one so stale drafts don't
 * need manual UI cleanup. Same double opt-in as upsert: ballot:write scope
 * plus any wallet grant (observer is enough).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);
  if (!applyRateLimit(req, res, { keySuffix: "v1/botBallots" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (req.method === "DELETE" && !enforceBodySize(req, res, 4 * 1024)) {
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
  // Bots keep the scope gate and per-bot budget. Humans fall through: a wallet
  // signer can already read and edit these ballots through the app's own tRPC
  // router, so refusing them here would only mean the UI can do something the
  // API cannot. Wallet authorization still applies to both, below.
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

  const walletId =
    req.method === "GET"
      ? typeof req.query.walletId === "string"
        ? req.query.walletId
        : ""
      : typeof req.body?.walletId === "string"
        ? req.body.walletId
        : "";
  if (!walletId) {
    return res.status(400).json({ error: "walletId is required" });
  }

  try {
    if (isBotJwt(payload)) {
      await assertBotWalletAccess(db, walletId, payload, false);
    } else {
      // Same signer-or-owner predicate every ballot procedure in the tRPC
      // router applies, so REST is no more permissive than the UI.
      await assertWalletAccess(
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
    if ((err as { code?: string })?.code === "NOT_FOUND") {
      return res.status(404).json({ error: "Wallet not found" });
    }
    return res.status(403).json({ error: "Not authorized for this wallet" });
  }

  if (req.method === "GET") {
    const ballots = await db.ballot.findMany({
      where: { walletId, type: GOV_BALLOT_TYPE },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json({
      ballots: ballots.map((b) => ({
        id: b.id,
        walletId: b.walletId,
        description: b.description,
        type: b.type,
        items: b.items,
        itemDescriptions: b.itemDescriptions,
        choices: b.choices,
        anchorUrls: b.anchorUrls,
        anchorHashes: b.anchorHashes,
        rationaleComments: b.rationaleComments,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      })),
    });
  }

  // DELETE
  const ballotId = typeof req.body?.ballotId === "string" ? req.body.ballotId : "";
  if (!ballotId) {
    return res.status(400).json({ error: "ballotId is required" });
  }

  const ballot = await db.ballot.findUnique({ where: { id: ballotId } });
  if (!ballot) {
    return res.status(404).json({ error: "Ballot not found" });
  }
  if (ballot.walletId !== walletId) {
    return res.status(400).json({ error: "Ballot does not belong to this wallet" });
  }
  if (ballot.type !== GOV_BALLOT_TYPE) {
    return res.status(400).json({ error: "Only governance ballots can be deleted via this endpoint" });
  }

  await db.ballot.delete({ where: { id: ballotId } });
  return res.status(200).json({ deleted: true, ballotId });
}
