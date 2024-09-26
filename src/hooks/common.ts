import { Wallet as DbWallet } from "@prisma/client";
import { Wallet } from "@/types/wallet";
import {
  NativeScript,
  resolveNativeScriptHash,
  resolvePaymentKeyHash,
  resolveScriptHashDRepId,
  serializeNativeScript,
} from "@meshsdk/core";

export function buildWallet(wallet: DbWallet, network: number) {
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

  const { address } = serializeNativeScript(
    nativeScript as NativeScript,
    wallet.stakeCredentialHash as undefined | string,
    network,
  );
  const dRepId = resolveScriptHashDRepId(
    resolveNativeScriptHash(nativeScript as NativeScript),
  );

  return {
    ...wallet,
    nativeScript,
    address,
    dRepId,
  } as Wallet;
}
