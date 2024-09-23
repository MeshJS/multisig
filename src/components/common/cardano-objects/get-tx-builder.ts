import { MeshTxBuilder } from "@meshsdk/core";
import { getProvider } from "./get-provider";

export function getTxBuilder(network: number) {
  const blockchainProvider = getProvider(network);
  const txBuilder = new MeshTxBuilder({
    fetcher: blockchainProvider,
    evaluator: blockchainProvider,
    verbose: true,
  });
  return txBuilder;
}
