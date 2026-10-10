import type { MultisigWallet } from "@/utils/multisigSDK";

export type DrepVoteContext = {
  dRepId: string;
  drepScriptCbor: string;
};

/**
 * Derives the DRep identity used to re-emit governance votes (the builder's
 * edit-vote flow). Prefers the multisig wallet's own DRep script — role-3
 * keys when present, otherwise the SDK's payment-script fallback — and falls
 * back to the app wallet's stored dRepId/scriptCbor for legacy wallets that
 * can't build a MultisigWallet.
 *
 * `getDRepId()` can throw on keyless wallets (`getDRepId105()!`), so the SDK
 * call is fenced.
 */
export function deriveDrepVoteContext(
  multisigWallet: MultisigWallet | undefined,
  appWallet:
    | { dRepId?: string | null; scriptCbor?: string | null }
    | undefined,
): DrepVoteContext | undefined {
  try {
    const drep = multisigWallet?.getDRep(
      appWallet?.dRepId && appWallet?.scriptCbor
        ? { dRepId: appWallet.dRepId, scriptCbor: appWallet.scriptCbor }
        : undefined,
    );
    if (drep) return { dRepId: drep.dRepId, drepScriptCbor: drep.drepCbor };
  } catch {
    // Fall through to the app-wallet fallback.
  }
  if (appWallet?.dRepId && appWallet?.scriptCbor) {
    return { dRepId: appWallet.dRepId, drepScriptCbor: appWallet.scriptCbor };
  }
  return undefined;
}
