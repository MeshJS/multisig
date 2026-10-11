import type { PrismaClient, Wallet as DbWallet } from "@prisma/client";
import type { UTxO } from "@meshsdk/core";
import {
  auditAuthTokenOutputs,
  findAuthTokenBurns,
  formatAuthTokenAuditError,
} from "@/lib/proxy/authTokenAudit";
import { resolveWalletScriptAddress } from "@/lib/server/walletScriptAddress";
import { getProvider } from "@/utils/get-provider";
import { addressToNetwork } from "@/utils/multisigSDK";
import type { DbWalletWithLegacy } from "@/types/wallet";

type ProxyLookupDb = Pick<PrismaClient, "proxy">;

export type ProxyUtxoFetcher = (proxyAddress: string) => Promise<UTxO[]>;

export {
  auditAuthTokenOutputs,
  findAuthTokenBurns,
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
 * Burn gate: if the transaction burns one of the wallet's auth-token policies, the
 * matching proxy address must be empty on-chain. After the burn the proxy validator
 * can never pass again, so any UTxO still there (a deposit that landed between the
 * cleanup sweep and the burn) would be locked forever.
 *
 * Returns an error message, or `null` when there is nothing to object to. A failed
 * chain lookup fails closed.
 */
export async function auditAuthTokenBurn(args: {
  txCbor: string;
  proxies: { authTokenId: string; proxyAddress: string }[];
  fetchProxyUtxos: ProxyUtxoFetcher;
  context: string;
}): Promise<string | null> {
  const scan = findAuthTokenBurns({
    txCbor: args.txCbor,
    authTokenIds: args.proxies.map((proxy) => proxy.authTokenId),
  });
  if (!scan.ok) {
    console.error(`${args.context}: burn scan failed`, { error: scan.error });
    return `Unable to verify proxy auth-token burn: ${scan.error}`;
  }
  if (scan.burnedPolicyIds.length === 0) return null;

  const burned = new Set(scan.burnedPolicyIds);
  const affected = args.proxies.filter((proxy) =>
    burned.has(proxy.authTokenId.trim().toLowerCase()),
  );
  const addresses = Array.from(new Set(affected.map((proxy) => proxy.proxyAddress)));

  for (const proxyAddress of addresses) {
    let utxos: UTxO[];
    try {
      utxos = await args.fetchProxyUtxos(proxyAddress);
    } catch (error) {
      console.error(`${args.context}: proxy balance lookup failed before burn`, error);
      return "Unable to verify the proxy address is empty before burning its auth tokens";
    }
    if (utxos.length > 0) {
      console.error(`${args.context}: refusing burn, proxy address not empty`, {
        proxyAddress,
        utxos: utxos.length,
      });
      return `Transaction burns the proxy auth tokens while the proxy address still holds ${utxos.length} UTxO(s); sweep them to the wallet before burning, or the funds are locked forever`;
    }
  }
  return null;
}

/**
 * Pre-sign audit for any pending transaction of a wallet. If the wallet has proxies
 * (active or not; a DB flag must not be able to switch this guard off while tokens can
 * still exist on-chain), decodes `txCbor` and refuses it when
 *  - a proxy auth token would end up anywhere other than the wallet's own script
 *    address, or
 *  - it burns a proxy's auth tokens while that proxy address still holds UTxOs.
 * Wallets without proxies are not affected (no extra work beyond one indexed lookup).
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
    /** Test seam; defaults to the Blockfrost provider for the wallet's network. */
    fetchProxyUtxos?: ProxyUtxoFetcher;
  },
): Promise<string | null> {
  const proxies = await db.proxy.findMany({
    where: { walletId: args.wallet.id },
    select: { authTokenId: true, proxyAddress: true },
  });
  if (proxies.length === 0) return null;

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

  const outputError = auditBuiltProxyTx({
    txCbor: args.txCbor,
    authTokenIds: proxies.map((proxy) => proxy.authTokenId),
    walletAddress,
    context: args.context,
  });
  if (outputError) return outputError;

  const fetchProxyUtxos =
    args.fetchProxyUtxos ??
    ((proxyAddress: string) =>
      getProvider(addressToNetwork(walletAddress)).fetchAddressUTxOs(proxyAddress));

  return auditAuthTokenBurn({
    txCbor: args.txCbor,
    proxies,
    fetchProxyUtxos,
    context: args.context,
  });
}
