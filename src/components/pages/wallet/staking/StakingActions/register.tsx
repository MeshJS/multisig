import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader } from "lucide-react";
import { StakingInfo } from "../stakingInfoCard";
import { Wallet } from "@/types/wallet";
import { deserializePoolId, UTxO } from "@meshsdk/core";
import { MultisigWallet } from "@/utils/multisigSDK";
import { ToastAction } from "@radix-ui/react-toast";
import { toast } from "@/hooks/use-toast";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { getProvider } from "@/utils/get-provider";
import useTransaction from "@/hooks/useTransaction";
export default function RegisterButton({
  stakingInfo,
  appWallet,
  mWallet,
  utxos,
  network,
  poolHex,
}: {
  stakingInfo: StakingInfo;
  appWallet: Wallet;
  mWallet: MultisigWallet;
  utxos: UTxO[];
  network: number;
  poolHex: string;
}) {
  const { newTransaction } = useTransaction();
  const [loading, setLoading] = useState(false);

  async function register() {
    setLoading(true);
    try {
      if (!mWallet) throw new Error("Multisig Wallet could not be built.");
      const rewardAddress = mWallet.getStakeAddress();
      if (!rewardAddress)
        throw new Error("Reward Address could not be built.");

      const txBuilder = getTxBuilder(network);
      const selectedUtxos = utxos;

      for (const utxo of selectedUtxos) {
        txBuilder
          .txIn(
            utxo.input.txHash,
            utxo.input.outputIndex,
            utxo.output.amount,
            utxo.output.address,
          )
          .txInScript(appWallet.scriptCbor);
      }
      txBuilder
        .selectUtxosFrom(utxos)
        .changeAddress(appWallet.address)
        //.registerStakeCertificate(rewardAddress)
        .delegateStakeCertificate(rewardAddress, poolHex);


      const paymentKeys = mWallet.getKeysByRole(0) ?? [];
      for (const key of paymentKeys) {
        txBuilder.requiredSignerHash(key.keyHash);
      }

      const stakingKeys = mWallet.getKeysByRole(2) ?? [];
      for (const key of stakingKeys) {
        txBuilder.requiredSignerHash(key.keyHash);
      }

      await newTransaction({
        txBuilder,
        description: `Register stake.`,
      });

      toast({
        title: "Transaction Successful",
        description: `Your Registration has been recorded.`,
        duration: 5000,
      });

    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("User rejected transaction")
      ) {
        toast({
          title: "Transaction Aborted",
          description: "You canceled the registration transaction.",
          duration: 5000,
        });
      } else {
        toast({
          title: "Transaction Failed",
          description: `Error: ${error}`,
          duration: 10000,
          action: (
            <ToastAction
              altText="Copy error"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(error));
                toast({
                  title: "Error Copied",
                  description: "Error details copied to clipboard.",
                  duration: 5000,
                });
              }}
            >
              Copy Error
            </ToastAction>
          ),
          variant: "destructive",
        });
        console.error("Transaction error:", error);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" onClick={register} disabled={loading}>
      {loading ? (
        <Loader className="mr-2 h-4 w-4 animate-spin" />
      ) : null}
      Register
    </Button>
  );
}
