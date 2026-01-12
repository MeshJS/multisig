import { DbWalletWithLegacy, Wallet } from "@/types/wallet";
import {
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

function addressToNetwork(address: string): number {
  return address.includes("test") ? 0 : 1;
}

/**
 * Determines the wallet type based on its structure.
 * 
 * - Type 2 (Summon): Has rawImportBodies.multisig
 * - Type 0 (Legacy): No stake keys, no stake credential hash, no DRep keys
 * - Type 1 (SDK): Everything else (built using multisig SDK)
 */
export type WalletType = 'legacy' | 'sdk' | 'summon';

export function getWalletType(wallet: DbWalletWithLegacy): WalletType {
  if (wallet.rawImportBodies?.multisig) return 'summon';
  
  // Legacy: only payment keys (no stake keys, no DRep keys)
  // External stake credential hash doesn't make it SDK - it's still legacy if only payment keys
  const hasStakeKeys = wallet.signersStakeKeys && wallet.signersStakeKeys.length > 0;
  const hasDRepKeys = wallet.signersDRepKeys && wallet.signersDRepKeys.length > 0;
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
  
  // Determine network from address if not provided
  if (network === undefined) {
    if (wallet.signersAddresses.length > 0) {
      network = addressToNetwork(wallet.signersAddresses[0]!);
    } else if (wallet.signersStakeKeys && wallet.signersStakeKeys.length > 0) {
      const stakeAddr = wallet.signersStakeKeys.find((s) => !!s);
      if (stakeAddr) {
        network = addressToNetwork(stakeAddr);
      } else {
        network = 1; // Default to mainnet if we can't determine
      }
    } else {
      network = 1; // Default to mainnet if we can't determine
    }
  }
  
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
  
  // Ensure network is set - determine from address if not provided
  if (network === undefined) {
    if (wallet.signersAddresses.length > 0) {
      network = addressToNetwork(wallet.signersAddresses[0]!);
    } else if (wallet.signersStakeKeys && wallet.signersStakeKeys.length > 0) {
      const stakeAddr = wallet.signersStakeKeys.find((s) => !!s);
      if (stakeAddr) {
        network = addressToNetwork(stakeAddr);
      } else {
        network = 1; // Default to mainnet if we can't determine
      }
    } else {
      network = 1; // Default to mainnet if we can't determine
    }
  }
  
  const stakeCredentialHash = wallet.stakeCredentialHash as undefined | string;
  const multisigWallet = new MultisigWallet(
    wallet.name,
    keys,
    wallet.description ?? "",
    wallet.numRequiredSigners ?? 1,
    network,
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

    // Always use stored payment script from rawImportBodies
    const scriptCbor = multisig.payment_script;
    if (!scriptCbor) {
      throw new Error("rawImportBodies.multisig.payment_script is required");
    }

    // Extract stake script from rawImportBodies
    const stakeScriptCbor = multisig.stake_script;

    // For rawImportBodies wallets, we need a minimal nativeScript for type compatibility
    // This won't be used for actual script derivation, but is required by the Wallet type
    const scriptType = (wallet.type as "all" | "any" | "atLeast") ?? "atLeast";
    const nativeScript: NativeScript = scriptType === "atLeast"
      ? {
          type: "atLeast",
          required: wallet.numRequiredSigners ?? 1,
          scripts: [],
        }
      : {
          type: scriptType,
          scripts: [],
        };

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
    // Build native script from payment keys in exact input order
    const validScripts = wallet.signersAddresses
      .filter((addr) => addr) // Filter out null/undefined addresses
      .map((addr) => {
        try {
          return {
            type: "sig" as const,
            keyHash: resolvePaymentKeyHash(addr!),
          };
        } catch (e) {
          if (process.env.NODE_ENV === "development") {
            console.warn(`Invalid payment address in buildWallet:`, addr);
          }
          return null;
        }
      })
      .filter((script): script is { type: "sig"; keyHash: string } => script !== null);

    if (validScripts.length === 0) {
      console.error("buildWallet: No valid payment addresses found");
      throw new Error("Failed to build wallet: No valid payment addresses");
    }

    const nativeScript = {
      type: (wallet.type as "all" | "any" | "atLeast") || "atLeast",
      scripts: validScripts,
    };
    if (nativeScript.type === "atLeast") {
      //@ts-ignore
      nativeScript.required = wallet.numRequiredSigners!;
    }

    // Build address from payment script with external stake credential hash if available
    // Legacy wallets can have external stake key hash but no individual stake keys
    const address = serializeNativeScript(
      nativeScript as NativeScript,
      wallet.stakeCredentialHash as undefined | string, // Use external stake credential hash if available
      network,
    ).address;

    // Compute DRep ID from payment script hash
    const dRepIdCip105 = resolveScriptHashDRepId(
      resolveNativeScriptHash(nativeScript as NativeScript),
    );
    const drepids = getDRepIds(dRepIdCip105);
    const dRepIdCip129 = drepids.cip129;

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
  const validScripts = wallet.signersAddresses
    .filter((addr) => addr)
    .map((addr) => {
      try {
        return {
          type: "sig" as const,
          keyHash: resolvePaymentKeyHash(addr!),
        };
      } catch (e) {
        if (process.env.NODE_ENV === "development") {
          console.warn(`Invalid payment address in buildWallet:`, addr);
        }
        return null;
      }
    })
    .filter((script): script is { type: "sig"; keyHash: string } => script !== null);

  if (validScripts.length === 0) {
    console.error("buildWallet: No valid payment addresses found");
    throw new Error("Failed to build wallet: No valid payment addresses");
  }

  const nativeScript = {
    type: (wallet.type as "all" | "any" | "atLeast") || "atLeast",
    scripts: validScripts,
  };
  if (nativeScript.type === "atLeast") {
    //@ts-ignore
    nativeScript.required = wallet.numRequiredSigners!;
  }

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
  const dRepIdCip105 = resolveScriptHashDRepId(
    resolveNativeScriptHash(nativeScript as NativeScript),
  );
  const drepids = getDRepIds(dRepIdCip105);
  const dRepIdCip129 = drepids.cip129;

  return {
    ...wallet,
    nativeScript,
    address,
    dRepId: dRepIdCip129,
  } as Wallet;
}
