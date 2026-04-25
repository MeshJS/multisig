import type { Wallet } from "@prisma/client";
import type { JwtPayload } from "@/lib/verifyJwt";
import { isBotJwt } from "@/lib/verifyJwt";
import { db } from "@/server/db";
import { assertBotWalletAccess } from "@/lib/auth/botAccess";
import { parseScope, scopeIncludes, type BotScope } from "@/lib/auth/botKey";

const SIGN_SCOPE = "multisig:sign" as BotScope;

/**
 * addTransaction-style auth plus bot `multisig:sign` scope for bot JWTs.
 */
export async function authorizeWalletSignerForV1Tx(
  payload: JwtPayload,
  walletId: string,
  address: string,
): Promise<{ wallet: Wallet }> {
  if (payload.address !== address) {
    const err = new Error("Address mismatch") as Error & { code: string };
    err.code = "ADDRESS_MISMATCH";
    throw err;
  }

  if (isBotJwt(payload)) {
    const botUser = await db.botUser.findUnique({
      where: { id: payload.botId },
      include: { botKey: true },
    });
    if (!botUser?.botKey) {
      const err = new Error("Bot not found");
      (err as { code?: string }).code = "BOT_NOT_FOUND";
      throw err;
    }
    const scopes = parseScope(botUser.botKey.scope);
    if (!scopeIncludes(scopes, SIGN_SCOPE)) {
      const err = new Error("Insufficient scope: multisig:sign required");
      (err as { code?: string }).code = "INSUFFICIENT_SCOPE";
      throw err;
    }
    await assertBotWalletAccess(db, walletId, payload, true);
    const wallet = await db.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) {
      const err = new Error("Wallet not found");
      (err as { code?: string }).code = "NOT_FOUND";
      throw err;
    }
    return { wallet };
  }

  const w = await db.wallet.findUnique({ where: { id: walletId } });
  const signers = w?.signersAddresses ?? [];
  if (!w || !signers.includes(address)) {
    const err = new Error("Not authorized for this wallet");
    (err as { code?: string }).code = "NOT_SIGNER";
    throw err;
  }
  return { wallet: w };
}
