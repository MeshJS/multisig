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
    wallet.stakeCredentialHash as undefined | string,
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
