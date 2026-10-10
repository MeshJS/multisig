import type { PrismaClient, Wallet as DbWallet } from "@prisma/client";
import {
  auditAuthTokenOutputs,
  formatAuthTokenAuditError,
} from "@/lib/proxy/authTokenAudit";
import { resolveWalletScriptAddress } from "@/lib/server/walletScriptAddress";
import type { DbWalletWithLegacy } from "@/types/wallet";

type ProxyLookupDb = Pick<PrismaClient, "proxy">;

export {
  auditAuthTokenOutputs,
  formatAuthTokenAuditError,
  type AuthTokenAuditResult,
} from "@/lib/proxy/authTokenAudit";

/**
 * Post-build audit for the v1 proxy handlers. Returns an error message when the
 * finished transaction would move a proxy auth token anywhere other than the multisig
 * wallet address, or `null` when it is safe to persist as a pending transaction.
 *
 * A non-null result means our own builder produced an unsafe transaction, so callers
 * should treat it as a server error, not a client error.
 */
export function auditBuiltProxyTx(args: {
  txCbor: string;
  authTokenIds: string[];
  walletAddress: string;
  context: string;
}): string | null {
  const result = auditAuthTokenOutputs({
    txCbor: args.txCbor,
    authTokenIds: args.authTokenIds,
    walletAddress: args.walletAddress,
  });
  if (result.ok) return null;
  console.error(`${args.context}: refusing to persist transaction`, {
    violations: result.violations,
  });
  return formatAuthTokenAuditError(result);
}

/**
 * Pre-sign audit for any pending transaction of a wallet. If the wallet has active
 * proxies, decodes `txCbor` and refuses it when a proxy auth token would end up
 * anywhere other than the wallet's own script address. Wallets without proxies are
 * not affected (no extra work beyond one indexed lookup).
 *
 * Returns an error message to surface to the signer, or `null` when safe. Resolution
 * failures fail closed only when the wallet actually has proxies to protect.
 */
export async function auditPendingTxForProxyWallet(
  db: ProxyLookupDb,
  args: {
    wallet: DbWallet;
    signerAddress: string;
    txCbor: string;
    context: string;
  },
): Promise<string | null> {
  const activeProxies = await db.proxy.findMany({
    where: { walletId: args.wallet.id, isActive: true },
    select: { authTokenId: true },
  });
  if (activeProxies.length === 0) return null;

  let walletAddress: string;
  try {
    walletAddress = resolveWalletScriptAddress(
      args.wallet as DbWalletWithLegacy,
      args.signerAddress,
    );
  } catch (error) {
    console.error(`${args.context}: wallet script address resolution failed`, error);
    return "Unable to verify proxy auth-token outputs: wallet script address resolution failed";
  }

  return auditBuiltProxyTx({
    txCbor: args.txCbor,
    authTokenIds: activeProxies.map((proxy) => proxy.authTokenId),
    walletAddress,
    context: args.context,
  });
}
