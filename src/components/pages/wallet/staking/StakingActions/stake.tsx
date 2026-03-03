import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader } from "lucide-react";
import { StakingInfo } from "../stakingInfoCard";
import { Wallet } from "@/types/wallet";
import { UTxO } from "@meshsdk/core";
import { MultisigWallet } from "@/utils/multisigSDK";
import { ToastAction } from "@radix-ui/react-toast";
import { toast } from "@/hooks/use-toast";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { STAKE_KEY_DEPOSIT } from "@/utils/protocol-deposit-constants";
import useTransaction from "@/hooks/useTransaction";

type StakingAction = "register" | "deregister" | "delegate" | "withdrawal" | "registerAndDelegate";

type StakingActionConfig = {
  execute: () => void;
  description: string;
  successTitle: string;
  successMessage: string;
};

function shouldApplyStakeDeposit(action: StakingAction): boolean {
  return action === "register" || action === "registerAndDelegate";
}

function buildStakingActionConfigs({
  txBuilder,
  rewardAddress,
  stakingScript,
  poolHex,
  rewards,
}: {
  txBuilder: ReturnType<typeof getTxBuilder>;
  rewardAddress: string;
  stakingScript: string;
  poolHex: string;
  rewards: string;
}): Record<StakingAction, StakingActionConfig> {
  return {
    register: {
      execute: () => txBuilder.registerStakeCertificate(rewardAddress).certificateScript(stakingScript),
      description: "Register stake.",
      successTitle: "Stake Registered",
      successMessage: "Your stake address has been registered.",
    },
    deregister: {
      execute: () => txBuilder.deregisterStakeCertificate(rewardAddress).certificateScript(stakingScript),
      description: "Deregister stake.",
      successTitle: "Stake Deregistered",
      successMessage: "Your stake address has been deregistered.",
    },
    delegate: {
      execute: () => txBuilder.delegateStakeCertificate(rewardAddress, poolHex).certificateScript(stakingScript),
      description: "Delegate stake.",
      successTitle: "Stake Delegated",
      successMessage: "Your stake has been delegated.",
    },
    withdrawal: {
      execute: () => txBuilder.withdrawal(rewardAddress, rewards),
      description: "Withdraw rewards.",
      successTitle: "Rewards Withdrawn",
      successMessage: "Your staking rewards have been withdrawn.",
    },
    registerAndDelegate: {
      execute: () => {
        txBuilder
          .registerStakeCertificate(rewardAddress)
          .certificateScript(stakingScript);
        txBuilder.delegateStakeCertificate(rewardAddress, poolHex).certificateScript(stakingScript);
      },
      description: "Register & delegate stake.",
      successTitle: "Stake Registered & Delegated",
      successMessage: "Your stake address has been registered and delegated.",
    },
  };
}
export default function StakeButton({
  stakingInfo,
  appWallet,
  mWallet,
  utxos,
  network,
  poolHex,
  action,
}: {
  stakingInfo: StakingInfo;
  appWallet: Wallet;
  mWallet: MultisigWallet;
  utxos: UTxO[];
  network: number;
  poolHex: string;
  action: StakingAction;
}) {
  const { newTransaction } = useTransaction();
  const [loading, setLoading] = useState(false);

  async function handleStake() {
    setLoading(true);
    try {
      if (!mWallet) throw new Error("Multisig Wallet could not be built.");

      const rewardAddress = appWallet.capabilities?.stakeAddress;
      if (!rewardAddress) throw new Error("Reward Address could not be built.");

      // For wallets with rawImportBodies or SDK, use stored stake script or derived
      const stakingScript = appWallet.stakeScriptCbor || (mWallet ? mWallet.getStakingScript() : undefined);
      if (!stakingScript) throw new Error("Staking Script could not be built.");

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

      const actionConfigs = buildStakingActionConfigs({
        txBuilder,
        rewardAddress,
        stakingScript,
        poolHex,
        rewards: stakingInfo.rewards,
      });
      const actionConfig = actionConfigs[action];

      if (shouldApplyStakeDeposit(action)) {
        txBuilder.protocolParams({ keyDeposit: STAKE_KEY_DEPOSIT });
      }

      actionConfig.execute();

      txBuilder.changeAddress(appWallet.address);

      await newTransaction({
        txBuilder,
        description: actionConfig.description,
      });

      toast({
        title: actionConfig.successTitle,
        description: actionConfig.successMessage,
        duration: 5000,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("User rejected transaction")
      ) {
        toast({
          title: "Transaction Aborted",
          description: "You canceled the transaction.",
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
    <Button variant="outline" onClick={handleStake} disabled={loading}>
      {loading ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : null}
      {action.charAt(0).toUpperCase() + action.slice(1)}
    </Button>
  );
}
