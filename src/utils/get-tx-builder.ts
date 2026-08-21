import { MeshTxBuilder } from "@meshsdk/core";
import { CSLSerializer } from "@meshsdk/core-csl";
import { getProvider } from "@/utils/get-provider";

export async function getTxBuilder(network: number, useCslSerializer = false) {
  const blockchainProvider = getProvider(network);
  const txBuilder = new MeshTxBuilder({
    fetcher: blockchainProvider,
    evaluator: blockchainProvider,
    ...(useCslSerializer ? { serializer: new CSLSerializer() } : {}),
    verbose: true,
  });
  if (network === 1) {
    txBuilder.setNetwork("mainnet");
  } else {
    txBuilder.setNetwork("preprod");
  }
  const costModels = await blockchainProvider.fetchCostModels();
  txBuilder.setCostModels(costModels);
  return txBuilder;
}
