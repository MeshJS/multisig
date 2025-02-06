import { useState } from "react";
import { useWallet } from "@meshsdk/react";
import useAppWallet from "@/hooks/useAppWallet";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader } from "lucide-react";

export default function DelegateButton({ drepid }: { drepid: string }) {
  const { wallet, connected } = useWallet();
  const { appWallet } = useAppWallet();
  const { toast } = useToast();
  const [delegating, setDelegating] = useState(false);

  async function handleDelegate() {
    if (!drepid) {
      toast({
        title: "Invalid DRep",
        description: "No valid DRep ID was provided.",
        variant: "destructive",
      });
      return;
    }
    if (!connected || !wallet) {
      toast({
        title: "Wallet Not Connected",
        description: "Please connect your wallet before delegating.",
        variant: "destructive",
      });
      return;
    }

    setDelegating(true);
    try {
      // console.log("Fetching UTXOs...");
      const utxos = await wallet.getUtxos();
      if (!utxos.length) {
        throw new Error("No available UTXOs found.");
      }

      // console.log("Fetching reward and change addresses...");
      const rewardAddresses = await wallet.getRewardAddresses();
      const rewardAddress = appWallet?.address || rewardAddresses[0];
      const changeAddress =
        appWallet?.address || (await wallet.getChangeAddress());

      if (!rewardAddress || !changeAddress) {
        throw new Error("Missing reward or change address.");
      }

      // console.log("Building delegation transaction...");
      const txBuilder = getTxBuilder(await wallet.getNetworkId());
      txBuilder
        .voteDelegationCertificate({ dRepId: drepid }, rewardAddress)
        .changeAddress(changeAddress)
        .selectUtxosFrom(utxos);

      const unsignedTx = await txBuilder.complete();
      // console.log("Unsigned TX:", unsignedTx);

      const signedTx = await wallet.signTx(unsignedTx);
      // console.log("Signed TX:", signedTx);

      const txHash = await wallet.submitTx(signedTx);
      // console.log("Transaction Submitted:", txHash);

      toast({
        title: "Delegation Successful",
        description: `Transaction submitted: ${txHash}`,
        duration: 10000,
      });
    } catch (error) {
      console.error("Delegation failed:", error);
      toast({
        title: "Delegation Failed",
        description: error instanceof Error ? error.message : "Unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setDelegating(false);
    }
  }

  return (
    <Button onClick={handleDelegate} disabled={delegating || !connected}>
      {delegating ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : null}
      {delegating ? "Delegating..." : "Delegate"}
    </Button>
  );
}