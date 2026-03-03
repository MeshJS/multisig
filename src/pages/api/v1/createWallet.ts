import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, applyBotRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { parseScope, scopeIncludes, type BotScope } from "@/lib/auth/botKey";
import { MultisigWallet, type MultisigKey } from "@/utils/multisigSDK";
import { resolvePaymentKeyHash, resolveStakeKeyHash } from "@meshsdk/core";
import { BotWalletRole } from "@prisma/client";

const CREATE_SCOPE = "multisig:create";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/createWallet" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!enforceBodySize(req, res, 10 * 1024)) {
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
    return res.status(403).json({ error: "Only bot tokens can create wallets via this API" });
  }

  if (!applyBotRateLimit(req, res, payload.botId, 20)) {
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
  if (!scopeIncludes(scopes, CREATE_SCOPE as BotScope)) {
    return res.status(403).json({ error: "Insufficient scope: multisig:create required" });
  }

  const body = req.body as {
    name?: string;
    description?: string;
    signersAddresses?: string[];
    signersDescriptions?: string[];
    signersStakeKeys?: (string | null)[];
    signersDRepKeys?: (string | null)[];
    numRequiredSigners?: number;
    scriptType?: "atLeast" | "all" | "any";
    stakeCredentialHash?: string;
    network?: number;
  };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 256) {
    return res.status(400).json({ error: "name is required (1–256 characters)" });
  }

  const signersAddresses = Array.isArray(body.signersAddresses)
    ? body.signersAddresses.filter((a): a is string => typeof a === "string")
    : [];
  if (signersAddresses.length === 0) {
    return res.status(400).json({ error: "signersAddresses must be a non-empty array of payment addresses" });
  }

  const signersDescriptions = Array.isArray(body.signersDescriptions)
    ? body.signersDescriptions.map((d) => (typeof d === "string" ? d : ""))
    : signersAddresses.map(() => "");
  const descs = signersAddresses.map((_, i) => signersDescriptions[i] ?? "");

  const signersStakeKeysRaw = Array.isArray(body.signersStakeKeys)
    ? body.signersStakeKeys
    : signersAddresses.map(() => "");
  const signersStakeKeys = signersAddresses.map((_, i) => {
    const v = signersStakeKeysRaw[i];
    return v === null || v === undefined ? "" : String(v);
  });

  const signersDRepKeysRaw = Array.isArray(body.signersDRepKeys)
    ? body.signersDRepKeys
    : signersAddresses.map(() => "");
  const signersDRepKeys = signersAddresses.map((_, i) => {
    const v = signersDRepKeysRaw[i];
    return v === null || v === undefined ? "" : String(v);
  });

  const numRequiredSigners =
    typeof body.numRequiredSigners === "number" && body.numRequiredSigners >= 1
      ? Math.min(body.numRequiredSigners, signersAddresses.length)
      : 1;

  const scriptType =
    body.scriptType === "all" || body.scriptType === "any" ? body.scriptType : "atLeast";
  const stakeCredentialHash =
    typeof body.stakeCredentialHash === "string" && body.stakeCredentialHash
      ? body.stakeCredentialHash
      : undefined;
  const network =
    typeof body.network === "number" && (body.network === 0 || body.network === 1)
      ? body.network
      : 1;

  const description =
    typeof body.description === "string" ? body.description.slice(0, 2000) : "";

  const keys: MultisigKey[] = [];

  for (let i = 0; i < signersAddresses.length; i++) {
    const addr = signersAddresses[i];
    if (!addr) continue;
    try {
      keys.push({
        keyHash: resolvePaymentKeyHash(addr),
        role: 0,
        name: descs[i] ?? "",
      });
    } catch {
      const hint =
        i === 1
          ? " If this is the bot's address, register it with a valid Cardano address via POST /api/v1/botAuth."
          : "";
      return res.status(400).json({
        error: `Invalid payment address at index ${i}`,
        details: `signersAddresses[${i}] is not a valid Cardano payment address.${hint}`,
      });
    }
  }

  if (!stakeCredentialHash && signersStakeKeys.some(Boolean)) {
    for (let i = 0; i < signersStakeKeys.length; i++) {
      const sk = signersStakeKeys[i];
      if (!sk) continue;
      try {
        keys.push({
          keyHash: resolveStakeKeyHash(sk),
          role: 2,
          name: descs[i] ?? "",
        });
      } catch {
        return res.status(400).json({ error: `Invalid stake address at index ${i}` });
      }
    }
  }

  for (let i = 0; i < signersDRepKeys.length; i++) {
    const drep = signersDRepKeys[i];
    if (!drep) continue;
    keys.push({ keyHash: drep, role: 3, name: descs[i] ?? "" });
  }

  if (keys.length === 0 && !stakeCredentialHash) {
    return res.status(400).json({ error: "No valid signer keys" });
  }

  const numRequired =
    scriptType === "all" || scriptType === "any" ? null : numRequiredSigners;

  let scriptCbor: string;
  let address: string;
  try {
    const multisigWallet = new MultisigWallet(
      name,
      keys,
      description,
      numRequiredSigners,
      network,
      stakeCredentialHash,
      scriptType,
    );
    const script = multisigWallet.getScript();
    if (!script.scriptCbor) {
      return res.status(400).json({ error: "Failed to build multisig script" });
    }
    scriptCbor = script.scriptCbor;
    address = script.address;
  } catch (e) {
    console.error("createWallet script build error:", e);
    return res.status(400).json({
      error: "Failed to build wallet script",
      details: e instanceof Error ? e.message : "Unknown error",
    });
  }

  try {
    const wallet = await db.wallet.create({
      data: {
        name,
        description: description || null,
        signersAddresses,
        signersDescriptions: descs,
        signersStakeKeys,
        signersDRepKeys,
        numRequiredSigners: numRequired,
        scriptCbor,
        stakeCredentialHash: stakeCredentialHash ?? null,
        type: scriptType,
        ownerAddress: payload.address,
      },
    });

    await db.walletBotAccess.upsert({
      where: {
        walletId_botId: { walletId: wallet.id, botId: payload.botId },
      },
      update: { role: BotWalletRole.cosigner },
      create: {
        walletId: wallet.id,
        botId: payload.botId,
        role: BotWalletRole.cosigner,
      },
    });

    res.status(201).json({
      walletId: wallet.id,
      address,
      name: wallet.name,
    });
  } catch (e) {
    console.error("createWallet db error:", e);
    res.status(500).json({ error: "Failed to create wallet" });
  }
}
