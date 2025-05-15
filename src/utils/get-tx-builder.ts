import { MeshTxBuilder } from "@meshsdk/core";
import { getProvider } from "@/utils/get-provider";
// import { CSLSerializer } from "@meshsdk/core-csl";

export function getTxBuilder(network: number) {
  const blockchainProvider = getProvider(network);
  const txBuilder = new MeshTxBuilder({
    fetcher: blockchainProvider,
    evaluator: blockchainProvider,
    // serializer: new CSLSerializer(),
    verbose: true,
  });
  if (network === 1) {
    txBuilder.setNetwork("mainnet");
  } else {
    txBuilder.setNetwork("preprod");
  }
  return txBuilder;
}
