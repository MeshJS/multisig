import type { PrismaClient } from "@prisma/client";
import type { JwtPayload } from "@/lib/verifyJwt";
import { isBotJwt } from "@/lib/verifyJwt";
import { BotWalletRole } from "@prisma/client";
import { parseScope, scopeIncludes, type BotScope } from "@/lib/auth/botKey";

export type BotAccessResult =
  | { allowed: false; reason: "wallet_not_found" | "not_granted" }
  | { allowed: true; role: "cosigner" | "observer" };

/**
 * Thrown by assertBotWalletAccess so callers can map the same condition to the
 * same HTTP status everywhere: 404 = wallet doesn't exist, 403 = wallet exists
 * but the bot isn't permitted (no grant, or observer on a mutating route).
 */
export class BotAccessError extends Error {
  constructor(
    public status: 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = "BotAccessError";
  }
}

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
  if (!wallet) return { allowed: false, reason: "wallet_not_found" };

  if (wallet.ownerAddress === "all") {
    return { allowed: true, role: "cosigner" };
  }

  const access = await db.walletBotAccess.findUnique({
    where: { walletId_botId: { walletId, botId } },
  });
  if (!access) return { allowed: false, reason: "not_granted" };

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
  const grants = await getWalletAccessForBot(db, botId);
  return grants.map(({ walletId, walletName }) => ({ walletId, walletName }));
}

/**
 * The bot's wallet grants with roles — lets a bot self-discover where it may
 * read/write instead of being told walletIds out-of-band.
 */
export async function getWalletAccessForBot(
  db: PrismaClient,
  botId: string,
): Promise<{ walletId: string; walletName: string; role: "cosigner" | "observer" }[]> {
  const accessList = await db.walletBotAccess.findMany({
    where: { botId },
    select: { walletId: true, role: true },
  });
  const roleByWalletId = new Map(
    accessList.map((a) => [
      a.walletId,
      a.role === BotWalletRole.cosigner ? ("cosigner" as const) : ("observer" as const),
    ]),
  );

  const wallets = await db.wallet.findMany({
    where: {
      OR: [{ ownerAddress: "all" }, { id: { in: Array.from(roleByWalletId.keys()) } }],
    },
    select: { id: true, name: true, ownerAddress: true },
  });

  return wallets.map((w) => ({
    walletId: w.id,
    walletName: w.name,
    // ownerAddress === "all" wallets are open to any bot as cosigner.
    role: roleByWalletId.get(w.id) ?? "cosigner",
  }));
}

/**
 * Whether the bot's key carries the given scope. Cheap pre-gate for mutating
 * routes so a scope-less bot gets a 403 before any body validation runs.
 */
export async function botHasScope(
  db: PrismaClient,
  botId: string,
  scope: BotScope,
): Promise<boolean> {
  const botUser = await db.botUser.findUnique({
    where: { id: botId },
    include: { botKey: { select: { scope: true } } },
  });
  if (!botUser?.botKey) return false;
  return scopeIncludes(parseScope(botUser.botKey.scope), scope);
}

/**
 * Assert bot can access wallet; if mutating, require cosigner. Returns the
 * wallet or throws a BotAccessError (404 unknown wallet, 403 not permitted).
 */
export async function assertBotWalletAccess(
  db: PrismaClient,
  walletId: string,
  payload: JwtPayload,
  mutating: boolean,
): Promise<{ wallet: { id: string; signersAddresses: string[]; numRequiredSigners: number | null; type: string }; role: "cosigner" | "observer" }> {
  if (!isBotJwt(payload)) throw new BotAccessError(403, "Not a bot payload");
  const result = await getBotWalletAccess(db, walletId, payload.botId);
  if (!result.allowed) {
    if (result.reason === "wallet_not_found") {
      throw new BotAccessError(404, "Wallet not found");
    }
    throw new BotAccessError(403, "Bot not allowed for this wallet");
  }
  if (mutating && result.role !== "cosigner") {
    throw new BotAccessError(403, "Bot observer cannot perform this action");
  }
  const wallet = await db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) throw new BotAccessError(404, "Wallet not found");
  return { wallet, role: result.role };
}
