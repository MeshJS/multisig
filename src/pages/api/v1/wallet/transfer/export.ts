import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit } from "@/lib/security/requestGuards";
import { getClientIP } from "@/lib/security/rateLimit";
import { audit } from "@/lib/observability/audit";
import {
  WALLET_TRANSFER_FORMAT,
  WALLET_TRANSFER_VERSION,
  type WalletTransferBallot,
  type WalletTransferContact,
  type WalletTransferPayloadV1,
  type WalletTransferType,
} from "@/types/walletTransfer";

const ALLOWED_TYPES: WalletTransferType[] = ["atLeast", "all", "any"];

function parseIncludeFlags(raw: unknown): { contacts: boolean; ballots: boolean } {
  const values = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  const set = new Set(values.map((v) => (typeof v === "string" ? v.trim() : "")));
  return { contacts: set.has("contacts"), ballots: set.has("ballots") };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/wallet/transfer/export" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized - Missing token" });
  }
  const jwt = verifyJwt(token);
  if (!jwt) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const walletId = typeof req.query.walletId === "string" ? req.query.walletId : null;
  if (!walletId) {
    return res.status(400).json({ error: "walletId query parameter is required" });
  }

  const include = parseIncludeFlags(req.query.include);

  const wallet = await db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found" });
  }

  const requester = jwt.address;
  const isOwner = wallet.ownerAddress === requester;
  if (!isOwner) {
    void audit(db, {
      actorAddress: requester,
      actorType: "user",
      action: "wallet.transfer.export",
      resourceType: "wallet",
      resourceId: walletId,
      ip: getClientIP(req),
      outcome: "denied",
      reason: "not_owner",
    });
    return res.status(403).json({ error: "Only the wallet owner can export this wallet" });
  }

  const type: WalletTransferType = ALLOWED_TYPES.includes(wallet.type as WalletTransferType)
    ? (wallet.type as WalletTransferType)
    : "atLeast";

  const payload: WalletTransferPayloadV1 = {
    format: WALLET_TRANSFER_FORMAT,
    version: WALLET_TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    exportedFromOrigin:
      (req.headers["x-forwarded-proto"] && req.headers.host
        ? `${req.headers["x-forwarded-proto"]}://${req.headers.host}`
        : `https://${req.headers.host ?? "multisig.meshjs.dev"}`),
    exporterAddress: requester,
    wallet: {
      name: wallet.name,
      description: wallet.description ?? "",
      type,
      signersAddresses: wallet.signersAddresses ?? [],
      signersStakeKeys: wallet.signersStakeKeys ?? [],
      signersDRepKeys: wallet.signersDRepKeys ?? [],
      signersDescriptions: wallet.signersDescriptions ?? [],
      numRequiredSigners: wallet.numRequiredSigners ?? null,
      scriptCbor: wallet.scriptCbor,
      stakeCredentialHash: wallet.stakeCredentialHash ?? null,
      profileImageIpfsUrl: wallet.profileImageIpfsUrl ?? null,
    },
  };

  if (include.contacts) {
    const contacts = await db.contact.findMany({
      where: { walletId },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    payload.contacts = contacts.map<WalletTransferContact>((c) => ({
      name: c.name,
      address: c.address,
      description: c.description ?? null,
    }));
  }

  if (include.ballots) {
    const ballots = await db.ballot.findMany({
      where: { walletId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    payload.ballots = ballots.map<WalletTransferBallot>((b) => ({
      description: b.description ?? null,
      items: b.items ?? [],
      itemDescriptions: b.itemDescriptions ?? [],
      choices: b.choices ?? [],
      anchorUrls: b.anchorUrls ?? [],
      anchorHashes: b.anchorHashes ?? [],
      rationaleComments: b.rationaleComments ?? [],
      type: b.type,
    }));
  }

  void audit(db, {
    actorAddress: requester,
    actorType: "user",
    action: "wallet.transfer.export",
    resourceType: "wallet",
    resourceId: walletId,
    ip: getClientIP(req),
    outcome: "success",
    metadata: {
      includeContacts: include.contacts,
      includeBallots: include.ballots,
      signerCount: payload.wallet.signersAddresses.length,
    },
  });

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(payload);
}
