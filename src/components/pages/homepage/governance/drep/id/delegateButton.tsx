import { useState } from "react";
import { useWallet } from "@meshsdk/react";
import useAppWallet from "@/hooks/useAppWallet";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function DelegateButton({ drepid }: { drepid: string }) {
  const { wallet, connected } = useWallet();
  const { appWallet } = useAppWallet();
  const { toast } = useToast();
  const [delegating, setDelegating] = useState(false);

  async function handleDelegate() {
    if (!drepid) return;
    if (!connected || !wallet) {
      toast({
        title: "Wallet Not Connected",
        description: "Please connect your wallet to delegate.",
        variant: "destructive",
      });
      return;
    }

    setDelegating(true);
    try {
      const utxos = await wallet.getUtxos();
      const rewardAddresses = await wallet.getRewardAddresses();
      const rewardAddress = appWallet?.address || rewardAddresses[0];
      const changeAddress =
        appWallet?.address || (await wallet.getChangeAddress());

      if (!rewardAddress || !changeAddress) {
        throw new Error("Missing reward or change address.");
      }

      const txBuilder = getTxBuilder(await wallet.getNetworkId());
      txBuilder
        .voteDelegationCertificate({ dRepId: drepid }, rewardAddress)
        .changeAddress(changeAddress)
        .selectUtxosFrom(utxos);
      
      const unsignedTx = await txBuilder.complete();
            
      console.log(unsignedTx)
      const signedTx = await wallet.signTx(unsignedTx);
      const txHash = await wallet.submitTx(signedTx);

      toast({
        title: "Delegation Successful",
        description: `Transaction hash: ${txHash}`,
        duration: 10000,
      });
    } catch (error) {
      console.error("Delegation failed:", error);
      toast({
        title: "Delegation Failed",
        description: "Failed to delegate. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDelegating(false);
    }
  }

  return (
    <Button onClick={handleDelegate} disabled={delegating || !connected}>
      {delegating ? "Delegating..." : "Delegate"}
    </Button>
  );
}