import { Wallet as DbWallet } from "@prisma/client";
import { Wallet } from "@/types/wallet";
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

function addressToNetwork(address: string): number {
  return address.includes("test") ? 0 : 1;
}

export function buildMultisigWallet(
  wallet: DbWallet,
  network?: number,
): MultisigWallet | undefined {
  console.log(
    "buildMultisigWallet - stakeCredentialHash",
    wallet.stakeCredentialHash,
  );

  const keys: MultisigKey[] = [];
  if (wallet.signersAddresses.length > 0) {
    if (!network) network = addressToNetwork(wallet.signersAddresses[0]!);
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
          console.warn(`Invalid payment address at index ${i}:`, addr);
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

  if (keys.length === 0 && !wallet.stakeCredentialHash) {
    console.warn(
      "buildMultisigWallet: no valid keys and no stakeCredentialHash provided",
      wallet,
    );
    return;
  }
  const stakeCredentialHash = wallet.stakeCredentialHash as undefined | string;
  const multisigWallet = new MultisigWallet(
    wallet.name,
    keys,
    wallet.description ?? "",
    wallet.numRequiredSigners ?? 1,
    network,
    stakeCredentialHash,
  );
  return multisigWallet;
}

export function buildWallet(
  wallet: DbWallet,
  network: number,
  utxos?: UTxO[],
): Wallet {
  console.log("hi");
  const mWallet = buildMultisigWallet(wallet, network);
  if (!mWallet) {
    console.error("error when building Multisig Wallet!");
    throw new Error("Failed to build Multisig Wallet");
  }

  //depricated -> only payment-script left in for compatibility
  //Remove later when refactoring
  const nativeScript = {
    type: wallet.type ? wallet.type : "atLeast",
    scripts: wallet.signersAddresses.map((addr) => ({
      type: "sig",
      keyHash: resolvePaymentKeyHash(addr),
    })),
  };
  if (nativeScript.type == "atLeast") {
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
