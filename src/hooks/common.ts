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
//import { getDRepIds } from "@meshsdk/core-csl";
import { Address, getDRepIds } from "@meshsdk/core-cst";
import { MultisigKey, MultisigWallet } from "@/utils/multisigSDK";

export function buildMultisigWallet(
  wallet: DbWalletWithLegacy,
  network: number,
): MultisigWallet | undefined {
  // For wallets with rawImportBodies, skip MultisigWallet building
  // These wallets use a build process not supported by our SDK
  if (wallet.rawImportBodies?.multisig) {
    return undefined;
  }

  const keys: MultisigKey[] = [];
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
          console.warn(`Invalid dRep address at index ${i}:`, dRepKey);
        }
      }
    });
  }
  if (keys.length === 0) return;
  const multisigWallet = new MultisigWallet(
    wallet.name,
    keys,
    wallet.description ?? "",
    wallet.numRequiredSigners ?? 1,
    network,
    wallet.stakeCredentialHash ?? undefined,
    (wallet.type as "all" | "any" | "atLeast") ?? "atLeast",
  );
  return multisigWallet;
}

export function buildWallet(
  wallet: DbWalletWithLegacy,
  network: number,
  utxos?: UTxO[],
): Wallet {
  if (!wallet) {
    throw new Error("buildWallet: wallet is required");
  }

  // For wallets with rawImportBodies, use stored values instead of deriving
  if (wallet.rawImportBodies?.multisig) {
    const multisig = wallet.rawImportBodies.multisig;
    
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

  // For wallets without rawImportBodies, use existing derivation logic
  const mWallet = buildMultisigWallet(wallet, network);
  if (!mWallet) {
    console.error("error when building Multisig Wallet!");
    throw new Error("Failed to build Multisig Wallet");
  }

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

  const paymentAddress = serializeNativeScript(
    nativeScript as NativeScript,
    wallet.stakeCredentialHash as undefined | string,
    network,
  ).address;

  let address = paymentAddress;

  const stakeableAddress = mWallet.getScript().address;

  const paymentAddrEmpty =
    utxos?.filter((f) => f.output.address === paymentAddress).length === 0;

  if (paymentAddrEmpty && mWallet.stakingEnabled()) address = stakeableAddress;

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
