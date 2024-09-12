import { Wallet as DbWallet } from "@prisma/client";
import { Wallet } from "@/types/wallet";
import {
  NativeScript,
  resolveNativeScriptHash,
  resolvePaymentKeyHash,
  resolveScriptHashDRepId,
  serializeNativeScript,
} from "@meshsdk/core";

export function buildWallet(wallet: DbWallet) {
  const nativeScript: NativeScript = {
    type: "atLeast",
    required: wallet.numberOfSigners,
    scripts: wallet.signers.map((addr) => ({
      type: "sig",
      keyHash: resolvePaymentKeyHash(addr),
    })),
  };
  const { address } = serializeNativeScript(nativeScript);
  const dRepId = resolveScriptHashDRepId(resolveNativeScriptHash(nativeScript));

  return {
    ...wallet,
    nativeScript,
    address,
    dRepId,
  } as Wallet;
}
