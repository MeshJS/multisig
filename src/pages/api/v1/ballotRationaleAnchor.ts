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
import { pinJsonLd, PinataUploadError } from "@/lib/server/pinataUpload";
import {
  buildRationaleAnchor,
  type RationaleInput,
} from "@/lib/server/rationaleAnchor";

const REQUIRED_SCOPE = "ballot:write";
const GOV_BALLOT_TYPE = 1;

/**
 * POST /api/v1/ballotRationaleAnchor
 *
 * Publish a ballot proposal's rationale to IPFS and record the resulting
 * anchor on the ballot row.
 *
 * Anchors were previously only settable by hand — pasted in, or round-tripped
 * through the ballot CSV. This closes that loop: the text already stored in
 * `rationaleComments` becomes a CIP-100/136 JSON-LD document, gets pinned, and
 * its URL and blake2b-256 hash are written back at the same proposal index,
 * ready for a human to submit the vote.
 *
 * It deliberately does not vote. Submitting the vote and signing stay with the
 * wallet's signers.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);
  if (!applyRateLimit(req, res, { keySuffix: "v1/ballotRationaleAnchor" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!enforceBodySize(req, res, 64 * 1024)) return;

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized - Missing token" });
  }
  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Bots need the ballot:write scope; humans are gated on wallet access alone,
  // matching botBallotsUpsert.
  if (isBotJwt(payload)) {
    if (!applyBotRateLimit(req, res, payload.botId)) return;
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
  const ballotId = typeof req.body?.ballotId === "string" ? req.body.ballotId : "";
  const proposalId = typeof req.body?.proposalId === "string" ? req.body.proposalId : "";
  if (!walletId || !ballotId || !proposalId) {
    return res
      .status(400)
      .json({ error: "walletId, ballotId and proposalId are required" });
  }

  try {
    if (isBotJwt(payload)) {
      await assertBotWalletAccess(db, walletId, payload, false);
    } else {
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

  const ballot = await db.ballot.findUnique({ where: { id: ballotId } });
  if (!ballot || ballot.walletId !== walletId) {
    return res.status(404).json({ error: "Ballot not found for this wallet" });
  }
  if (ballot.type !== GOV_BALLOT_TYPE) {
    return res.status(400).json({ error: "Not a governance ballot" });
  }

  const index = ballot.items.indexOf(proposalId);
  if (index === -1) {
    return res.status(404).json({ error: "Proposal not found on this ballot" });
  }

  // Body overrides win; otherwise publish what is already drafted on the ballot.
  const storedComment = ballot.rationaleComments[index] ?? "";
  const summary =
    typeof req.body?.summary === "string" && req.body.summary.trim()
      ? req.body.summary
      : storedComment;
  const rationaleStatement =
    typeof req.body?.rationaleStatement === "string" && req.body.rationaleStatement.trim()
      ? req.body.rationaleStatement
      : storedComment;

  if (!summary.trim() || !rationaleStatement.trim()) {
    return res.status(400).json({
      error:
        "No rationale to publish. Draft a rationaleComment for this proposal first, or pass summary and rationaleStatement.",
    });
  }

  const input: RationaleInput = {
    summary,
    rationaleStatement,
    ...(typeof req.body?.precedentDiscussion === "string"
      ? { precedentDiscussion: req.body.precedentDiscussion }
      : {}),
    ...(typeof req.body?.counterargumentDiscussion === "string"
      ? { counterargumentDiscussion: req.body.counterargumentDiscussion }
      : {}),
    ...(typeof req.body?.conclusion === "string"
      ? { conclusion: req.body.conclusion }
      : {}),
    ...(Array.isArray(req.body?.references)
      ? { references: req.body.references }
      : {}),
  };

  try {
    // Imported here rather than at module scope: @meshsdk/core pulls the whisky
    // WASM, and this route is reachable from the MCP tool registry.
    const { hashDrepAnchor } = await import("@meshsdk/core");
    const anchor = buildRationaleAnchor(
      input,
      (doc) => hashDrepAnchor(doc as never),
      `rationale-${proposalId}`,
    );

    // Pin the same string that was hashed — see the note in rationaleAnchor.ts.
    const pinned = await pinJsonLd(anchor.filename, anchor.json);

    const anchorUrls = [...ballot.anchorUrls];
    const anchorHashes = [...ballot.anchorHashes];
    while (anchorUrls.length < ballot.items.length) anchorUrls.push("");
    while (anchorHashes.length < ballot.items.length) anchorHashes.push("");
    anchorUrls[index] = pinned.url;
    anchorHashes[index] = anchor.hash;

    const updated = await db.ballot.update({
      where: { id: ballotId },
      data: { anchorUrls, anchorHashes },
    });

    return res.status(200).json({
      ballotId: updated.id,
      proposalId,
      index,
      anchorUrl: pinned.url,
      anchorHash: anchor.hash,
      cid: pinned.cid,
    });
  } catch (error) {
    if (error instanceof PinataUploadError) {
      return res
        .status(error.status === 413 ? 413 : 502)
        .json({ error: error.message });
    }
    console.error("[v1/ballotRationaleAnchor] failed:", error);
    return res.status(500).json({ error: "Failed to publish rationale" });
  }
}
