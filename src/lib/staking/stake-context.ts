import type { MultisigWallet } from "@/utils/multisigSDK";

export type StakeCertContext = {
  rewardAddress: string;
  stakeScriptCbor: string;
};

/**
 * Derives the staking identity used to re-emit staking certificates (the
 * builder's edit-staking flow). Mirrors the staking page's derivation
 * (StakingActions/stake.tsx): reward address from the multisig wallet,
 * script preferring the app wallet's stored stakeScriptCbor (imported
 * wallets) over the SDK-derived staking script.
 *
 * `getStakeAddress()` can throw on keyless wallets (`getStakeCredentialHash()!`),
 * so the SDK calls are fenced.
 */
export function deriveStakeCertContext(
  multisigWallet: MultisigWallet | undefined,
  appWallet: { stakeScriptCbor?: string | null } | undefined,
): StakeCertContext | undefined {
  try {
    const rewardAddress = multisigWallet?.getStakeAddress();
    const stakeScriptCbor =
      appWallet?.stakeScriptCbor || multisigWallet?.getStakingScript();
    if (rewardAddress && stakeScriptCbor) {
      return { rewardAddress, stakeScriptCbor };
    }
  } catch {
    // Fall through — no staking identity available.
  }
  return undefined;
}
