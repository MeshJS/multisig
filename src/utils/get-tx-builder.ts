import { MeshTxBuilder } from "@meshsdk/core";
import { getProvider } from "@/utils/get-provider";
import { STAKE_KEY_DEPOSIT } from "@/utils/staking-constants";
// import { CSLSerializer } from "@meshsdk/core-csl";

export function getTxBuilder(network: number) {
  const blockchainProvider = getProvider(network);
  const txBuilder = new MeshTxBuilder({
    fetcher: blockchainProvider,
    evaluator: blockchainProvider,
    params: {
      // Explicitly provide stake key deposit so certificate balancing
      // remains deterministic even when fetcher protocol params vary.
      keyDeposit: STAKE_KEY_DEPOSIT,
    },
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
