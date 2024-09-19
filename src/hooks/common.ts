import { Wallet as DbWallet } from "@prisma/client";
import { Wallet } from "@/types/wallet";
import {
  NativeScript,
  resolveNativeScriptHash,
  resolvePaymentKeyHash,
  resolveScriptHashDRepId,
  serializeNativeScript,
} from "@meshsdk/core";
import { stakeCredentialHash } from "@/data/cardano";

export function buildWallet(wallet: DbWallet, network: number) {
  const nativeScript: NativeScript = {
    type: "atLeast",
    required: wallet.numRequiredSigners,
    scripts: wallet.signersAddresses.map((addr) => ({
      type: "sig",
      keyHash: resolvePaymentKeyHash(addr),
    })),
  };
  const { address } = serializeNativeScript(
    nativeScript,
    stakeCredentialHash,
    network,
  );
  const dRepId = resolveScriptHashDRepId(resolveNativeScriptHash(nativeScript));

  return {
    ...wallet,
    nativeScript,
    address,
    dRepId,
  } as Wallet;
}
