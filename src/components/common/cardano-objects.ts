import { env } from "@/env";
import { BlockfrostProvider, MeshTxBuilder } from "@meshsdk/core";

export function getProvider(network: number) {
  return new BlockfrostProvider(
    network == 0
      ? env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD
      : env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET,
  );
}

export function getTxBuilder(network: number) {
  const blockchainProvider = getProvider(network);
  const txBuilder = new MeshTxBuilder({
    fetcher: blockchainProvider,
    evaluator: blockchainProvider,
    verbose: true,
  });
  return txBuilder;
}
