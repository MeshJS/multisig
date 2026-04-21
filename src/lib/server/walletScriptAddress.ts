import type { Wallet as DbWallet } from "@prisma/client";
import { buildMultisigWallet } from "@/utils/common";
import { addressToNetwork } from "@/utils/multisigSDK";
import { serializeNativeScript } from "@meshsdk/core";
import { DbWalletWithLegacy } from "@/types/wallet";
import {
  decodeNativeScriptFromCbor,
  decodedToNativeScript,
} from "@/utils/nativeScriptUtils";

/**
 * Same resolution as GET /api/v1/freeUtxos: multisig script address for SDK wallets,
 * otherwise native script + stake credential from stored scriptCbor.
 */
export function resolveWalletScriptAddress(
  wallet: DbWalletWithLegacy,
  fallbackAddress: string,
): string {
  const mWallet = buildMultisigWallet(wallet);
  if (mWallet) {
    return mWallet.getScript().address;
  }

  const canonicalScriptCbor = wallet.scriptCbor?.trim();
  if (!canonicalScriptCbor) {
    throw new Error("Wallet is missing canonical scriptCbor");
  }

  const decoded = decodeNativeScriptFromCbor(canonicalScriptCbor);
  const nativeScript = decodedToNativeScript(decoded);
  const signerAddress = wallet.signersAddresses.find(
    (candidate) => typeof candidate === "string" && candidate.trim().length > 0,
  );
  const network = addressToNetwork(signerAddress ?? fallbackAddress);
  return serializeNativeScript(
    nativeScript,
    wallet.stakeCredentialHash ?? undefined,
    network,
  ).address;
}

export function resolveWalletScriptAddressSafe(
  wallet: DbWallet,
  fallbackAddress: string,
): { address: string } | { error: string } {
  try {
    return { address: resolveWalletScriptAddress(wallet as DbWalletWithLegacy, fallbackAddress) };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Wallet script address resolution failed",
    };
  }
}
