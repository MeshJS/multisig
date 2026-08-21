import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit, enforceBodySize } from "@/lib/security/requestGuards";
import { getClientIP } from "@/lib/security/rateLimit";
import { audit } from "@/lib/observability/audit";
import {
  WALLET_TRANSFER_FORMAT,
  WALLET_TRANSFER_VERSION,
  type WalletTransferBallot,
  type WalletTransferContact,
  type WalletTransferDefinition,
  type WalletTransferPayloadV1,
  type WalletTransferType,
} from "@/types/walletTransfer";

const ALLOWED_TYPES: WalletTransferType[] = ["atLeast", "all", "any"];
const MAX_SIGNERS = 200;
const MAX_CONTACTS = 500;
const MAX_BALLOTS = 200;

function stripHtml(input: string): string {
  let out = "";
  let inTag = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "<") {
      inTag = true;
      continue;
    }
    if (ch === ">") {
      inTag = false;
      continue;
    }
    if (!inTag) out += ch;
  }
  return out;
}

function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return stripHtml(value).slice(0, maxLen).trim();
}

function asStringArray(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((v) => (typeof v === "string" ? sanitizeText(v, maxLen) : ""));
}

function validateDefinition(input: unknown): { ok: true; value: WalletTransferDefinition } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "wallet field must be an object" };
  }
  const w = input as Record<string, unknown>;
  const name = sanitizeText(w.name, 256);
  if (!name) return { ok: false, error: "wallet.name is required" };
  const type = w.type as WalletTransferType;
  if (!ALLOWED_TYPES.includes(type)) {
    return { ok: false, error: "wallet.type must be 'atLeast', 'all', or 'any'" };
  }
  const scriptCbor = typeof w.scriptCbor === "string" ? w.scriptCbor.trim() : "";
  if (!scriptCbor) {
    return { ok: false, error: "wallet.scriptCbor is required" };
  }
  const signersAddresses = asStringArray(w.signersAddresses, MAX_SIGNERS, 512);
  if (signersAddresses.length === 0) {
    return { ok: false, error: "wallet.signersAddresses must be a non-empty array" };
  }
  const signersStakeKeys = asStringArray(w.signersStakeKeys, MAX_SIGNERS, 512);
  const signersDRepKeys = asStringArray(w.signersDRepKeys, MAX_SIGNERS, 512);
  const signersDescriptions = asStringArray(w.signersDescriptions, MAX_SIGNERS, 256);
  const description = sanitizeText(w.description, 2000);

  let numRequiredSigners: number | null = null;
  if (type === "atLeast") {
    const n = w.numRequiredSigners;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 1) {
      return { ok: false, error: "wallet.numRequiredSigners must be a positive number when type is 'atLeast'" };
    }
    numRequiredSigners = Math.min(Math.floor(n), signersAddresses.length);
  }

  const stakeCredentialHash =
    typeof w.stakeCredentialHash === "string" && w.stakeCredentialHash.length > 0
      ? w.stakeCredentialHash
      : null;
  const profileImageIpfsUrl =
    typeof w.profileImageIpfsUrl === "string" && w.profileImageIpfsUrl.length > 0
      ? w.profileImageIpfsUrl.slice(0, 1024)
      : null;

  return {
    ok: true,
    value: {
      name,
      description,
      type,
      signersAddresses,
      signersStakeKeys: signersStakeKeys.length ? signersStakeKeys : signersAddresses.map(() => ""),
      signersDRepKeys: signersDRepKeys.length ? signersDRepKeys : signersAddresses.map(() => ""),
      signersDescriptions: signersDescriptions.length ? signersDescriptions : signersAddresses.map(() => ""),
      numRequiredSigners,
      scriptCbor,
      stakeCredentialHash,
      profileImageIpfsUrl,
    },
  };
}

function validateContacts(input: unknown): WalletTransferContact[] {
  if (!Array.isArray(input)) return [];
  const result: WalletTransferContact[] = [];
  for (const c of input.slice(0, MAX_CONTACTS)) {
    if (typeof c !== "object" || c === null) continue;
    const obj = c as Record<string, unknown>;
    const name = sanitizeText(obj.name, 128);
    const address = sanitizeText(obj.address, 512);
    if (!name || !address) continue;
    result.push({
      name,
      address,
      description: sanitizeText(obj.description, 1000) || null,
    });
  }
  return result;
}

function validateBallots(input: unknown): WalletTransferBallot[] {
  if (!Array.isArray(input)) return [];
  const result: WalletTransferBallot[] = [];
  for (const b of input.slice(0, MAX_BALLOTS)) {
    if (typeof b !== "object" || b === null) continue;
    const obj = b as Record<string, unknown>;
    const items = asStringArray(obj.items, 256, 256);
    if (items.length === 0) continue;
    result.push({
      description: sanitizeText(obj.description, 1000) || null,
      items,
      itemDescriptions: asStringArray(obj.itemDescriptions, 256, 1000),
      choices: asStringArray(obj.choices, 256, 32),
      anchorUrls: asStringArray(obj.anchorUrls, 256, 1024),
      anchorHashes: asStringArray(obj.anchorHashes, 256, 256),
      rationaleComments: asStringArray(obj.rationaleComments, 256, 4000),
      type:
        typeof obj.type === "number" && Number.isFinite(obj.type)
          ? Math.floor(obj.type)
          : 0,
    });
  }
  return result;
}

function buildInviteUrl(req: NextApiRequest, newWalletId: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const host = req.headers.host ?? "multisig.meshjs.dev";
  return `${proto}://${host}/wallets/invite/${newWalletId}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/wallet/transfer/import", maxRequests: 5 })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!enforceBodySize(req, res, 200 * 1024)) {
    return;
  }

  if (typeof req.body !== "object" || req.body === null) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const body = req.body as Partial<WalletTransferPayloadV1>;

  if (body.format !== WALLET_TRANSFER_FORMAT) {
    return res.status(400).json({ error: "Invalid payload format" });
  }
  if (body.version !== WALLET_TRANSFER_VERSION) {
    return res.status(400).json({ error: `Unsupported payload version (expected ${WALLET_TRANSFER_VERSION})` });
  }

  const validation = validateDefinition(body.wallet);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  const def = validation.value;

  const contacts = validateContacts(body.contacts);
  const ballots = validateBallots(body.ballots);

  try {
    const exporterAddress = sanitizeText(body.exporterAddress, 512) || null;
    const exportedFromOrigin = sanitizeText(body.exportedFromOrigin, 512) || null;

    const newWallet = await db.newWallet.create({
      data: {
        name: def.name,
        description: def.description,
        signersAddresses: def.signersAddresses,
        signersStakeKeys: def.signersStakeKeys,
        signersDRepKeys: def.signersDRepKeys,
        signersDescriptions: def.signersDescriptions,
        numRequiredSigners: def.numRequiredSigners ?? null,
        ownerAddress: "all",
        stakeCredentialHash: def.stakeCredentialHash,
        scriptType: def.type,
        paymentCbor: def.scriptCbor,
        stakeCbor: "",
        usesStored: false,
        rawImportBodies: {
          source: "wallet-transfer",
          exporterAddress,
          exportedFromOrigin,
          exportedAt: typeof body.exportedAt === "string" ? body.exportedAt : null,
          profileImageIpfsUrl: def.profileImageIpfsUrl ?? null,
        },
      },
    });

    if (contacts.length > 0) {
      await db.contact.createMany({
        data: contacts.map((c) => ({
          walletId: newWallet.id,
          name: c.name,
          address: c.address,
          description: c.description ?? null,
        })),
        skipDuplicates: true,
      });
    }

    if (ballots.length > 0) {
      await db.ballot.createMany({
        data: ballots.map((b) => ({
          walletId: newWallet.id,
          description: b.description ?? null,
          items: b.items,
          itemDescriptions: b.itemDescriptions,
          choices: b.choices,
          anchorUrls: b.anchorUrls,
          anchorHashes: b.anchorHashes,
          rationaleComments: b.rationaleComments,
          type: b.type,
        })),
      });
    }

    const inviteUrl = buildInviteUrl(req, newWallet.id);

    void audit(db, {
      actorAddress: exporterAddress,
      actorType: "user",
      action: "wallet.transfer.import",
      resourceType: "wallet",
      resourceId: newWallet.id,
      ip: getClientIP(req),
      outcome: "success",
      metadata: {
        exportedFromOrigin,
        signerCount: def.signersAddresses.length,
        contactCount: contacts.length,
        ballotCount: ballots.length,
      },
    });

    return res.status(200).json({
      newWalletId: newWallet.id,
      inviteUrl,
    });
  } catch (err) {
    console.error("[api/v1/wallet/transfer/import] failed:", err);
    return res.status(500).json({ error: "Failed to import wallet" });
  }
}
