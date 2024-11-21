import { MeshTxBuilder } from "@meshsdk/core";
import { getProvider } from "./get-provider";

export function getTxBuilder(network: number) {
  const blockchainProvider = getProvider(network);
  const txBuilder = new MeshTxBuilder({
    fetcher: blockchainProvider,
    evaluator: blockchainProvider,
    verbose: true,
  });
  if (network === 1) {
    txBuilder.setNetwork("mainnet");
  } else {
    txBuilder.setNetwork("preprod");
  }
  return txBuilder;
}
