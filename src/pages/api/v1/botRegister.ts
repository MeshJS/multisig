import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyStrictRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { generateClaimCode, sha256, BOT_SCOPES, type BotScope } from "@/lib/auth/botKey";

const CLAIM_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);

  if (!applyStrictRateLimit(req, res, { keySuffix: "v1/botRegister" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!enforceBodySize(req, res, 2 * 1024)) {
    return;
  }

  const { name, paymentAddress, stakeAddress, requestedScopes } = req.body;

  // --- Validate input ---

  if (typeof name !== "string" || name.length < 1 || name.length > 100) {
    return res.status(400).json({ error: "invalid_registration_payload", message: "name must be a string between 1 and 100 characters" });
  }

  if (typeof paymentAddress !== "string" || paymentAddress.length < 20) {
    return res.status(400).json({ error: "invalid_registration_payload", message: "Invalid paymentAddress" });
  }

  if (stakeAddress !== undefined && stakeAddress !== null && typeof stakeAddress !== "string") {
    return res.status(400).json({ error: "invalid_registration_payload", message: "stakeAddress must be a string if provided" });
  }

  if (!Array.isArray(requestedScopes) || requestedScopes.length === 0) {
    return res.status(400).json({ error: "invalid_registration_payload", message: "requestedScopes must be a non-empty array" });
  }

  const validScopes = requestedScopes.filter(
    (s): s is BotScope => typeof s === "string" && (BOT_SCOPES as readonly string[]).includes(s),
  );
  if (validScopes.length !== requestedScopes.length) {
    return res.status(400).json({ error: "invalid_registration_payload", message: "requestedScopes contains invalid scope values" });
  }

  // --- Check address not already registered to a claimed bot or existing BotUser ---

  const existingBotUser = await db.botUser.findUnique({ where: { paymentAddress } });
  if (existingBotUser) {
    return res.status(409).json({ error: "address_already_registered", message: "This address is already registered to a bot" });
  }

  const existingClaimed = await db.pendingBot.findFirst({
    where: { paymentAddress, status: "CLAIMED", pickedUp: false },
  });
  if (existingClaimed) {
    return res.status(409).json({ error: "address_already_registered", message: "This address has a pending claimed bot" });
  }

  // --- Generate claim code and create records ---

  const claimCode = generateClaimCode();
  const tokenHash = sha256(claimCode);
  const expiresAt = new Date(Date.now() + CLAIM_CODE_TTL_MS);

  const pendingBot = await db.$transaction(async (tx) => {
    const bot = await tx.pendingBot.create({
      data: {
        name,
        paymentAddress,
        stakeAddress: typeof stakeAddress === "string" ? stakeAddress : null,
        requestedScopes: JSON.stringify(validScopes),
        status: "UNCLAIMED",
        expiresAt,
      },
    });

    await tx.botClaimToken.create({
      data: {
        pendingBotId: bot.id,
        tokenHash,
        expiresAt,
      },
    });

    return bot;
  });

  return res.status(201).json({
    pendingBotId: pendingBot.id,
    claimCode,
    claimExpiresAt: expiresAt.toISOString(),
  });
}
