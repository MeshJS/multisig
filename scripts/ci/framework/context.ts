import { readFile } from "fs/promises";
import type { CIBootstrapContext, CIBotContext, CIWalletType } from "./types";

function assertString(name: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid context: ${name} must be a non-empty string`);
  }
  return value.trim();
}

function assertStringArray(name: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid context: ${name} must be a non-empty array`);
  }
  const normalized = value.map((item, idx) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`Invalid context: ${name}[${idx}] must be a non-empty string`);
    }
    return item.trim();
  });
  return normalized;
}

function normalizeWalletType(value: unknown): CIWalletType {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "legacy" || v === "hierarchical" || v === "sdk") return v;
  throw new Error(`Invalid context: unsupported wallet type '${String(value)}'`);
}

function normalizeBots(input: Record<string, unknown>): {
  bots: CIBotContext[];
  defaultBotId?: string;
} {
  const botsRaw = input.bots;
  if (!Array.isArray(botsRaw) || botsRaw.length === 0) {
    throw new Error("Invalid context: bots must be a non-empty array for schemaVersion 2");
  }
  const bots = botsRaw.map((bot, idx) => {
    if (!bot || typeof bot !== "object") {
      throw new Error(`Invalid context: bots[${idx}] must be an object`);
    }
    const b = bot as Record<string, unknown>;
    return {
      id: assertString(`bots[${idx}].id`, b.id),
      paymentAddress: assertString(`bots[${idx}].paymentAddress`, b.paymentAddress),
      botKeyId: assertString(`bots[${idx}].botKeyId`, b.botKeyId),
      botId: typeof b.botId === "string" && b.botId.trim() ? b.botId.trim() : undefined,
    } satisfies CIBotContext;
  });

  const defaultBotIdRaw = typeof input.defaultBotId === "string" ? input.defaultBotId.trim() : "";
  const defaultBotId = defaultBotIdRaw || bots[0]?.id;
  return { bots, defaultBotId };
}

export function validateBootstrapContext(raw: unknown): CIBootstrapContext {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid context: expected JSON object");
  }

  const input = raw as Record<string, unknown>;
  if (Number(input.schemaVersion) !== 2) {
    throw new Error(
      `Invalid context: unsupported schemaVersion '${String(input.schemaVersion)}' (expected 2)`,
    );
  }

  const walletsRaw = input.wallets;
  if (!Array.isArray(walletsRaw) || walletsRaw.length === 0) {
    throw new Error("Invalid context: wallets must be a non-empty array");
  }

  const wallets = walletsRaw.map((wallet, idx) => {
    if (!wallet || typeof wallet !== "object") {
      throw new Error(`Invalid context: wallets[${idx}] must be an object`);
    }
    const w = wallet as Record<string, unknown>;
    return {
      type: normalizeWalletType(w.type),
      walletId: assertString(`wallets[${idx}].walletId`, w.walletId),
      walletAddress: assertString(`wallets[${idx}].walletAddress`, w.walletAddress),
      transactionId: assertString(`wallets[${idx}].transactionId`, w.transactionId),
      signerAddresses: assertStringArray(`wallets[${idx}].signerAddresses`, w.signerAddresses),
    };
  });

  const walletTypesRaw = Array.isArray(input.walletTypes) ? input.walletTypes : wallets.map((w) => w.type);
  const walletTypes = walletTypesRaw.map((v) => normalizeWalletType(v));
  const signerAddresses = assertStringArray("signerAddresses", input.signerAddresses);
  const normalizedBots = normalizeBots(input);
  const defaultBot =
    normalizedBots.bots.find((bot) => bot.id === normalizedBots.defaultBotId) ??
    normalizedBots.bots[0];
  if (!defaultBot) {
    throw new Error("Invalid context: unable to resolve default bot");
  }

  return {
    schemaVersion: 2,
    createdAt: assertString("createdAt", input.createdAt ?? new Date().toISOString()),
    apiBaseUrl: assertString("apiBaseUrl", input.apiBaseUrl),
    networkId: Number(input.networkId) === 1 ? 1 : 0,
    walletTypes,
    wallets,
    bots: normalizedBots.bots,
    defaultBotId: normalizedBots.defaultBotId,
    walletId: typeof input.walletId === "string" ? input.walletId : wallets[0]?.walletId,
    walletAddress:
      typeof input.walletAddress === "string" ? input.walletAddress : wallets[0]?.walletAddress,
    signerAddresses,
    transactionId:
      typeof input.transactionId === "string" ? input.transactionId : wallets[0]?.transactionId,
  };
}

export async function loadBootstrapContext(contextPath: string): Promise<CIBootstrapContext> {
  const raw = await readFile(contextPath, "utf8");
  return validateBootstrapContext(JSON.parse(raw));
}
