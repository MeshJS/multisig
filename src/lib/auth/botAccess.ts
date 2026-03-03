import type { PrismaClient } from "@prisma/client";
import type { JwtPayload } from "@/lib/verifyJwt";
import { isBotJwt } from "@/lib/verifyJwt";
import { BotWalletRole } from "@prisma/client";

export type BotAccessResult =
  | { allowed: false }
  | { allowed: true; role: "cosigner" | "observer" };

/**
 * Check if a bot (by botId) can access the given wallet and with what role.
 * Wallet must have ownerAddress === "all" or a WalletBotAccess row for (walletId, botId).
 */
export async function getBotWalletAccess(
  db: PrismaClient,
  walletId: string,
  botId: string,
): Promise<BotAccessResult> {
  const wallet = await db.wallet.findUnique({
    where: { id: walletId },
    select: { id: true, ownerAddress: true },
  });
  if (!wallet) return { allowed: false };

  if (wallet.ownerAddress === "all") {
    return { allowed: true, role: "cosigner" };
  }

  const access = await db.walletBotAccess.findUnique({
    where: { walletId_botId: { walletId, botId } },
  });
  if (!access) return { allowed: false };

  const role = access.role === BotWalletRole.cosigner ? "cosigner" : "observer";
  return { allowed: true, role };
}

/**
 * Return wallet IDs and names that the bot is allowed to see (ownerAddress "all" or has WalletBotAccess).
 */
export async function getWalletIdsForBot(
  db: PrismaClient,
  botId: string,
): Promise<{ walletId: string; walletName: string }[]> {
  const accessList = await db.walletBotAccess.findMany({
    where: { botId },
    select: { walletId: true },
  });
  const accessWalletIds = new Set(accessList.map((a) => a.walletId));

  const walletsAll = await db.wallet.findMany({
    where: {
      OR: [{ ownerAddress: "all" }, { id: { in: Array.from(accessWalletIds) } }],
    },
    select: { id: true, name: true },
  });

  return walletsAll.map((w) => ({ walletId: w.id, walletName: w.name }));
}

/**
 * Assert bot can access wallet; if mutating, require cosigner. Returns the wallet or throws (caller should send 403).
 */
export async function assertBotWalletAccess(
  db: PrismaClient,
  walletId: string,
  payload: JwtPayload,
  mutating: boolean,
): Promise<{ wallet: { id: string; signersAddresses: string[]; numRequiredSigners: number | null; type: string }; role: "cosigner" | "observer" }> {
  if (!isBotJwt(payload)) throw new Error("Not a bot payload");
  const result = await getBotWalletAccess(db, walletId, payload.botId);
  if (!result.allowed) throw new Error("Bot not allowed for this wallet");
  if (mutating && result.role !== "cosigner") throw new Error("Bot observer cannot perform this action");
  const wallet = await db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) throw new Error("Wallet not found");
  return { wallet, role: result.role };
}
