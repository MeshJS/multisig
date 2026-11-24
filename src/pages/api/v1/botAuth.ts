import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import jwt from "jsonwebtoken";

const { sign } = jwt;
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyStrictRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { verifyBotKeySecret, parseScope, scopeIncludes, type BotScope } from "@/lib/auth/botKey";
import {
  boundAddressNetworkId,
  checkBotPaymentAddress,
  checkBotStakeAddress,
} from "@/lib/auth/botAddress";

const MIN_SCOPE = "multisig:read";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);

  if (!applyStrictRateLimit(req, res, { keySuffix: "v1/botAuth", maxRequests: 15 })) {
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

  const { botKeyId, secret, paymentAddress, stakeAddress } = req.body;

  if (typeof botKeyId !== "string" || typeof secret !== "string") {
    return res.status(400).json({
      error: "Missing required fields: botKeyId, secret",
    });
  }

  // The bot's identity is the address BOUND to its key server-side — never
  // whatever the caller asserts. paymentAddress is only needed on the FIRST
  // auth (it binds the address); afterwards it may be omitted, and if sent it
  // must match the bound address.
  const hasAddress = paymentAddress !== undefined && paymentAddress !== null;
  if (hasAddress && typeof paymentAddress !== "string") {
    return res.status(400).json({ error: "Invalid paymentAddress" });
  }

  const botKey = await db.botKey.findUnique({ where: { id: botKeyId } });
  if (!botKey) {
    return res.status(401).json({ error: "Invalid bot key" });
  }

  if (!verifyBotKeySecret(secret, botKey.keyHash)) {
    return res.status(401).json({ error: "Invalid bot key" });
  }

  const scopes = parseScope(botKey.scope);
  if (!scopeIncludes(scopes, MIN_SCOPE as BotScope)) {
    return res.status(403).json({ error: "Insufficient scope" });
  }

  // Non-strings and "" mean "no stake address", as they always have.
  const stake = typeof stakeAddress === "string" && stakeAddress !== "" ? stakeAddress : null;

  let botUser = await db.botUser.findUnique({ where: { botKeyId: botKey.id } });
  if (botUser) {
    // Compared as a string, never re-parsed: bots bound before addresses were
    // validated keep authenticating with the address they were bound to.
    if (hasAddress && paymentAddress !== botUser.paymentAddress) {
      return res.status(409).json({
        error: "paymentAddress does not match the address bound to this bot key",
      });
    }
    // A stake address that is not a key-based one on the bound address's
    // network is ignored rather than failing the auth: the stored value stays,
    // and a client that keeps sending a placeholder is not locked out.
    if (
      stake &&
      stake !== botUser.stakeAddress &&
      checkBotStakeAddress(stake, boundAddressNetworkId(botUser.paymentAddress)).ok
    ) {
      botUser = await db.botUser.update({
        where: { id: botUser.id },
        data: { stakeAddress: stake },
      });
    }
  } else {
    if (!hasAddress) {
      return res.status(400).json({
        error: "paymentAddress is required on the first botAuth — it binds the bot's address",
      });
    }
    // The binding below is permanent, so this is the moment to check that the
    // bot can actually sign for the address (see lib/auth/botAddress).
    const paymentCheck = checkBotPaymentAddress(paymentAddress);
    if (!paymentCheck.ok) {
      return res.status(400).json({ error: "Invalid paymentAddress", details: paymentCheck.message });
    }
    if (stake) {
      const stakeCheck = checkBotStakeAddress(stake, paymentCheck.networkId);
      if (!stakeCheck.ok) {
        return res.status(400).json({ error: "Invalid stakeAddress", details: stakeCheck.message });
      }
    }
    const existingByAddress = await db.botUser.findUnique({ where: { paymentAddress } });
    if (existingByAddress) {
      return res.status(409).json({ error: "This address is already registered to another bot" });
    }
    try {
      botUser = await db.botUser.create({
        data: {
          botKeyId: botKey.id,
          paymentAddress,
          stakeAddress: stake,
          // Address-less registrations create their BotUser here on first auth;
          // carry the registration name over like the claim path does.
          displayName: botKey.name,
        },
      });
    } catch (error) {
      // Two first-auths racing past the lookups above: one wins, the other
      // hits the unique index on botKeyId or paymentAddress. That is the same
      // conflict the lookups report, not a server error.
      if ((error as { code?: unknown } | null)?.code === "P2002") {
        return res.status(409).json({ error: "This bot key or address was bound concurrently; retry botAuth" });
      }
      throw error;
    }
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not defined");
  }

  const token = sign(
    { address: botUser.paymentAddress, botId: botUser.id, type: "bot" as const },
    jwtSecret,
    { expiresIn: "1h" },
  );

  return res.status(200).json({ token, botId: botUser.id });
}
