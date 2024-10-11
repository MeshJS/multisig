import Button from "@/components/common/button";
import ConnectWallet from "@/components/common/cardano-objects/connect-wallet";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import { BlockfrostDrepInfo } from "@/types/wallet";
import { keepRelevant, Quantity, Unit } from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { useEffect, useState } from "react";

export default function DrepLandingPage({ drepid }: { drepid: string }) {
  const network = 0; // todo how to get network?
  const { connected, wallet } = useWallet();
  const [drepInfo, setDrepInfo] = useState<BlockfrostDrepInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    async function load() {
      const blockchainProvider = getProvider(network);
      const drepInfotmp: BlockfrostDrepInfo = await blockchainProvider.get(
        `/governance/dreps/${drepid}`,
      );
      console.log(111, " drepInfotmp", drepInfotmp);

      const drepInfo: BlockfrostDrepInfo = await blockchainProvider.get(
        `/governance/dreps/${drepid}/metadata`,
      );
      console.log(222, " drepInfo", drepInfo);
      if (drepInfo) setDrepInfo(drepInfo);
    }
    if (drepid) load();
  }, [drepid]);

  async function delegate() {
    setLoading(true);
    try {
      if (!connected) throw new Error("Wallet not connected");

      const utxos = await wallet.getUtxos();
      const rewardAddresses = await wallet.getRewardAddresses();
      const rewardAddress = rewardAddresses[0];
      if (rewardAddress === undefined)
        throw new Error("No reward address found");

      const changeAddress = await wallet.getChangeAddress();

      const assetMap = new Map<Unit, Quantity>();
      assetMap.set("lovelace", "5000000");
      const selectedUtxos = keepRelevant(assetMap, utxos);

      const txBuilder = getTxBuilder(network);

      for (const utxo of selectedUtxos) {
        txBuilder.txIn(
          utxo.input.txHash,
          utxo.input.outputIndex,
          utxo.output.amount,
          utxo.output.address,
        );
      }

      txBuilder
        .voteDelegationCertificate(
          {
            dRepId: drepid,
          },
          rewardAddress,
        )
        .changeAddress(changeAddress);

      const unsignedTx = await txBuilder.complete();
      const signedTx = await wallet.signTx(unsignedTx);
      const txHash = await wallet.submitTx(signedTx);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  return (
    <>
      {drepInfo && JSON.stringify(drepInfo, null, 2)}

      <div className="flex items-center justify-center">
        {connected ? (
          <Button onClick={() => delegate()} disabled={loading}>
            {loading ? "..." : "Delegate"}
          </Button>
        ) : (
          <div>
            <ConnectWallet />
          </div>
        )}
      </div>
    </>
  );
}
