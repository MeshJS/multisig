import { env } from "@/env";
import { BlockfrostProvider, MeshTxBuilder } from "@meshsdk/core";

export function getProvider() {
  return new BlockfrostProvider(env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD);
}

export function getTxBuilder() {
  const blockchainProvider = getProvider();
  const txBuilder = new MeshTxBuilder({
    fetcher: blockchainProvider,
    evaluator: blockchainProvider,
    verbose: true,
  });
  return txBuilder;
}
