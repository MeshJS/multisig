import { DbWalletWithLegacy, Wallet } from "@/types/wallet";
import {
  deserializeAddress,
  NativeScript,
  resolveNativeScriptHash,
  resolvePaymentKeyHash,
  resolveScriptHashDRepId,
  resolveStakeKeyHash,
  serializeNativeScript,
  UTxO,
} from "@meshsdk/core";
import { getDRepIds } from "@meshsdk/core-cst";
import { MultisigKey, MultisigWallet } from "@/utils/multisigSDK";
import {
  decodeNativeScriptFromCbor,
  buildPaymentSigScriptsFromAddresses,
  decodedToNativeScript,
  normalizeHex,
  scriptHashFromCbor,
} from "@/utils/nativeScriptUtils";

function addressToNetwork(address: string): number {
  return address.includes("test") ? 0 : 1;
}

function resolveWalletNetwork(wallet: DbWalletWithLegacy, network?: number): number {
  if (network !== undefined) {
    return network;
  }

  if (wallet.signersAddresses.length > 0) {
    return addressToNetwork(wallet.signersAddresses[0]!);
  }

  if (wallet.signersStakeKeys && wallet.signersStakeKeys.length > 0) {
    const stakeAddr = wallet.signersStakeKeys.find((s) => !!s);
    if (stakeAddr) {
      return addressToNetwork(stakeAddr);
    }
  }

  // Default to mainnet when we cannot infer from stored addresses.
  return 1;
}

function buildPaymentSigScripts(
  wallet: DbWalletWithLegacy,
): Array<{ type: "sig"; keyHash: string }> {
  return buildPaymentSigScriptsFromAddresses(
    wallet.signersAddresses,
    (addr) => {
      if (process.env.NODE_ENV === "development") {
        console.warn("Invalid payment address in buildWallet:", addr);
      }
    },
  );
}

function buildNativeScriptFromPaymentSigners(
  wallet: DbWalletWithLegacy,
  validScripts: Array<{ type: "sig"; keyHash: string }>,
): NativeScript {
  const nativeScript = {
    type: (wallet.type as "all" | "any" | "atLeast") || "atLeast",
    scripts: validScripts,
  } as NativeScript;
  if (nativeScript.type === "atLeast") {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - Mesh NativeScript "atLeast" variant requires "required".
    nativeScript.required = wallet.numRequiredSigners!;
  }
  return nativeScript;
}

function buildDRepIdFromScript(nativeScript: NativeScript): string {
  const dRepIdCip105 = resolveScriptHashDRepId(
    resolveNativeScriptHash(nativeScript),
  );
  const drepids = getDRepIds(dRepIdCip105);
  return drepids.cip129;
}

function resolveSummonScriptCbors(args: {
  address: string;
  paymentScript?: string | null;
  stakeScript?: string | null;
}): { paymentScriptCbor?: string; stakeScriptCbor?: string } {
  const paymentScript = args.paymentScript?.trim() || undefined;
  const stakeScript = args.stakeScript?.trim() || undefined;

  if (!paymentScript && !stakeScript) {
    return {};
  }

  const paymentScriptHash = scriptHashFromCbor(paymentScript);
  const stakeScriptHash = scriptHashFromCbor(stakeScript);

  let addressScriptHash: string | undefined;
  try {
    const parsed = deserializeAddress(args.address) as {
      scriptHash?: string;
      scriptCredentialHash?: string;
    };
    addressScriptHash = normalizeHex(
      parsed.scriptHash || parsed.scriptCredentialHash,
    );
  } catch {
    addressScriptHash = undefined;
  }

  if (addressScriptHash) {
    if (paymentScriptHash === addressScriptHash) {
      return { paymentScriptCbor: paymentScript, stakeScriptCbor: stakeScript };
    }
    if (stakeScriptHash === addressScriptHash) {
      return { paymentScriptCbor: stakeScript, stakeScriptCbor: paymentScript };
    }
  }

  return { paymentScriptCbor: paymentScript, stakeScriptCbor: stakeScript };
}

/**
 * Determines the wallet type based on its structure.
 * 
 * - Type 2 (Summon): Has rawImportBodies.multisig
 * - Type 0 (Legacy): No stake keys, no stake credential hash, no DRep keys
 * - Type 1 (SDK): Everything else (built using multisig SDK)
 */
export type WalletType = 'legacy' | 'sdk' | 'summon';

function hasNonEmptyEntries(values?: string[] | null): boolean {
  return !!values?.some((value) => value.trim().length > 0);
}

export function getWalletType(wallet: DbWalletWithLegacy): WalletType {
  if (wallet.rawImportBodies?.multisig) return 'summon';
  
  // Legacy: only payment keys (no stake keys, no DRep keys)
  // External stake credential hash doesn't make it SDK - it's still legacy if only payment keys
  const hasStakeKeys = hasNonEmptyEntries(wallet.signersStakeKeys);
  const hasDRepKeys = hasNonEmptyEntries(wallet.signersDRepKeys);
  if (!hasStakeKeys && !hasDRepKeys) return 'legacy';
  
  return 'sdk';
}

/**
 * Builds a MultisigWallet instance for SDK wallets (Type 1) only.
 * Returns undefined for Legacy (Type 0) and Summon (Type 2) wallets.
 */
export function buildMultisigWallet(
  wallet: DbWalletWithLegacy,
  network?: number,
): MultisigWallet | undefined {
  const walletType = getWalletType(wallet);
  
  // Only build MultisigWallet for SDK wallets
  if (walletType !== 'sdk') {
    return undefined;
  }

  const keys: MultisigKey[] = [];
  const resolvedNetwork = resolveWalletNetwork(wallet, network);
  
  // Add payment keys (role 0)
  if (wallet.signersAddresses.length > 0) {
    wallet.signersAddresses.forEach((addr, i) => {
      if (addr) {
        try {
          const paymentHash = resolvePaymentKeyHash(addr);
          keys.push({
            keyHash: paymentHash,
            role: 0,
            name: wallet.signersDescriptions[i] || "",
          });
        } catch (e) {
          if (process.env.NODE_ENV === "development") {
            console.warn(`Invalid payment address at index ${i}:`, addr);
          }
        }
      }
    });
  }
  
  // Add staking keys (role 2)
  if (wallet.signersStakeKeys && wallet.signersStakeKeys.length > 0) {
    wallet.signersStakeKeys.forEach((stakeKey, i) => {
      if (stakeKey) {
        try {
          const stakeKeyHash = resolveStakeKeyHash(stakeKey);
          keys.push({
            keyHash: stakeKeyHash,
            role: 2,
            name: wallet.signersDescriptions[i] || "",
          });
        } catch (e) {
          console.warn(`Invalid stake address at index ${i}:`, stakeKey);
        }
      }
    });
  }
  
  // Add DRep keys (role 3)
  if (wallet.signersDRepKeys && wallet.signersDRepKeys.length > 0) {
    wallet.signersDRepKeys.forEach((dRepKey, i) => {
      if (dRepKey) {
        try {
          keys.push({
            keyHash: dRepKey,
            role: 3,
            name: wallet.signersDescriptions[i] || "",
          });
        } catch (e) {
          console.warn(`Invalid dRep key at index ${i}:`, dRepKey);
        }
      }
    });
  }

  if (keys.length === 0 && !wallet.stakeCredentialHash) {
    console.warn(
      "buildMultisigWallet: no valid keys and no stakeCredentialHash provided",
      wallet,
    );
    return undefined;
  }

  const stakeCredentialHash = wallet.stakeCredentialHash as undefined | string;
  const multisigWallet = new MultisigWallet(
    wallet.name,
    keys,
    wallet.description ?? "",
    wallet.numRequiredSigners ?? 1,
    resolvedNetwork,
    stakeCredentialHash,
    (wallet.type as "all" | "any" | "atLeast") ?? "atLeast",
  );
  return multisigWallet;
}

/**
 * Builds a Wallet instance based on the wallet type.
 * 
 * - Type 2 (Summon): Uses rawImportBodies data as-is
 * - Type 0 (Legacy): Builds native script directly from payment keys in input order
 * - Type 1 (SDK): Uses MultisigWallet for all operations
 */
export function buildWallet(
  wallet: DbWalletWithLegacy,
  network: number,
  utxos?: UTxO[],
): Wallet {
  if (!wallet) {
    throw new Error("buildWallet: wallet is required");
  }

  const walletType = getWalletType(wallet);

  // Type 2 (Summon): Use rawImportBodies data as-is
  if (walletType === 'summon') {
    const multisig = wallet.rawImportBodies?.multisig;
    if (!multisig) {
      throw new Error("rawImportBodies.multisig is required for Summon wallets");
    }
    
    // Always use stored address from rawImportBodies
    const address = multisig.address;
    if (!address) {
      throw new Error("rawImportBodies.multisig.address is required");
    }

    const { paymentScriptCbor, stakeScriptCbor } = resolveSummonScriptCbors({
      address,
      paymentScript: multisig.payment_script,
      stakeScript: multisig.stake_script,
    });

    // Always use the script that matches the address payment credential hash
    const scriptCbor = paymentScriptCbor;
    if (!scriptCbor) {
      throw new Error("A valid payment script is required in rawImportBodies.multisig");
    }

    // Decode actual script structure from stored CBOR for display/inspection.
    // The scriptCbor itself (used for address derivation and signing) remains unchanged.
    const scriptType = (wallet.type as "all" | "any" | "atLeast") ?? "atLeast";
    let nativeScript: NativeScript;
    try {
      const decoded = decodeNativeScriptFromCbor(scriptCbor);
      nativeScript = decodedToNativeScript(decoded);
    } catch {
      // Fallback to placeholder if decoding fails
      nativeScript = scriptType === "atLeast"
        ? {
            type: "atLeast",
            required: wallet.numRequiredSigners ?? 1,
            scripts: [],
          }
        : {
            type: scriptType,
            scripts: [],
          };
    }

    // For rawImportBodies wallets, dRepId cannot be easily derived from stored CBOR
    // Set to empty string - it can be derived later if needed from the actual script
    const dRepId = "";

    return {
      ...wallet,
      scriptCbor,
      nativeScript,
      address,
      dRepId,
      stakeScriptCbor,
    } as Wallet;
  }

  // Type 0 (Legacy): Build native script directly from payment keys in input order
  if (walletType === 'legacy') {
    const validScripts = buildPaymentSigScripts(wallet);

    if (validScripts.length === 0) {
      console.error("buildWallet: No valid payment addresses found");
      throw new Error("Failed to build wallet: No valid payment addresses");
    }

    const nativeScript = buildNativeScriptFromPaymentSigners(wallet, validScripts);

    // Build address from payment script with external stake credential hash if available
    // Legacy wallets can have external stake key hash but no individual stake keys
    const address = serializeNativeScript(
      nativeScript as NativeScript,
      wallet.stakeCredentialHash as undefined | string, // Use external stake credential hash if available
      network,
    ).address;

    const dRepIdCip129 = buildDRepIdFromScript(nativeScript);

    return {
      ...wallet,
      nativeScript,
      address,
      dRepId: dRepIdCip129,
    } as Wallet;
  }

  // Type 1 (SDK): Use MultisigWallet for all operations
  const mWallet = buildMultisigWallet(wallet, network);
  if (!mWallet) {
    console.error("error when building Multisig Wallet!");
    throw new Error("Failed to build Multisig Wallet");
  }

  // Build native script from payment keys for compatibility
  const validScripts = buildPaymentSigScripts(wallet);

  if (validScripts.length === 0) {
    console.error("buildWallet: No valid payment addresses found");
    throw new Error("Failed to build wallet: No valid payment addresses");
  }

  const nativeScript = buildNativeScriptFromPaymentSigners(wallet, validScripts);

  // Use SDK address (prefer stakeable address if staking is enabled)
  const paymentAddress = serializeNativeScript(
    nativeScript as NativeScript,
    wallet.stakeCredentialHash as undefined | string,
    network,
  ).address;

  let address = paymentAddress;
  const stakeableAddress = mWallet.getScript().address;
  const paymentAddrEmpty =
    utxos?.filter((f) => f.output.address === paymentAddress).length === 0;

  if (paymentAddrEmpty && mWallet.stakingEnabled()) {
    address = stakeableAddress;
  }

  // Compute DRep ID from payment script hash (SDK can override this via getDRepId)
  const dRepIdCip129 = buildDRepIdFromScript(nativeScript);

  return {
    ...wallet,
    nativeScript,
    address,
    dRepId: dRepIdCip129,
  } as Wallet;
}
