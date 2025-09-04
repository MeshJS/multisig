import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Wallet, Download, AlertTriangle, Shield } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@meshsdk/react";
import { Asset, MeshTxBuilder, UTxO } from "@meshsdk/core";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";
import { MeshCrowdfundContract } from "../offchain";
import { CrowdfundDatumTS } from "../../crowdfund";
import { api } from "@/utils/api";

interface WithdrawFromCrowdfundProps {
  crowdfund: any;
  onSuccess?: () => void;
}

export function WithdrawFromCrowdfund({
  crowdfund,
  onSuccess,
}: WithdrawFromCrowdfundProps) {
  const [amount, setAmount] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const { toast } = useToast();
  const datumData = JSON.parse(crowdfund.datum);
  const totalRaised = datumData.current_fundraised_amount;
  const crowdfundName = crowdfund.name;
  const shareToken = datumData.share_token;
  const { connected, wallet } = useWallet();
  const network = useSiteStore((state) => state.network);

  const [withdrawableUtxo, setWithdrawableUtxo] = useState<UTxO>();
  const [withdrawableAmount, setWithdrawableAmount] = useState<number>(0);

  // Add the updateCrowdfund mutation
  const updateCrowdfund = api.crowdfund.updateCrowdfund.useMutation({
    onSuccess: () => {
      toast({
        title: "Crowdfund updated successfully",
        description:
          "The crowdfund data has been updated with your contribution.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to update crowdfund",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (wallet && shareToken) {
      wallet.getUtxos().then((utxos) => {
        utxos.forEach((utxo: UTxO) => {
          const shareTokenAmount = utxo.output.amount.filter((amount: Asset) =>
            amount.unit.includes(shareToken),
          );
          if (shareTokenAmount) {
            setWithdrawableAmount(Number(shareTokenAmount[0]?.quantity));
            setWithdrawableUtxo(utxo);
          }
        });
      });
    }
  }, [wallet, shareToken]);

  const provider = useMemo(() => {
    return network != null ? getProvider(network) : null;
  }, [network]);

  const meshTxBuilder = useMemo(() => {
    if (!provider) return null;
    return new MeshTxBuilder({
      fetcher: provider,
      submitter: provider,
      verbose: true,
    });
  }, [provider]);

  const handleWithdraw = async () => {
    if (!connected) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet first.",
      });
      return;
    }

    if (!provider || !meshTxBuilder || network == null || !wallet) {
      toast({
        title: "Initializing…",
        description: "Wallet/network not ready yet. Try again in a moment.",
      });
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid withdrawal amount.",
      });
      return;
    }
    const withdrawAmount = Number(amount) * 1000000;
    console.log("withdrawableAmount", withdrawableAmount);
    console.log("withdrawAmount", withdrawAmount);

    if (withdrawableAmount < withdrawAmount) {
      toast({
        title: "Insufficient funds",
        description:
          "You cannot withdraw more than your original contribution amount.",
      });
      return;
    }

    setIsWithdrawing(true);

    try {
      const contract = new MeshCrowdfundContract(
        {
          mesh: meshTxBuilder,
          fetcher: provider,
          wallet: wallet,
          networkId: network,
        },
        {
          proposerKeyHash: crowdfund.proposerKeyHashR0,
          paramUtxo: JSON.parse(crowdfund.paramUtxo),
        },
      );

      const { tx } = await contract.withdrawCrowdfund(
        withdrawAmount,
        datumData,
      );

      // Sign and submit the transaction
      const signedTx = await wallet.signTx(tx);
      console.log(await provider.submitTx(signedTx));
      const txHash = await wallet.submitTx(signedTx);

      // Update the datum with the new values
      const updatedDatum: CrowdfundDatumTS = {
        completion_script: datumData.completion_script,
        share_token: datumData.share_token,
        crowdfund_address: datumData.crowdfund_address,
        fundraise_target: datumData.fundraise_target,
        current_fundraised_amount:
          datumData.current_fundraised_amount - withdrawAmount,
        allow_over_subscription: datumData.allow_over_subscription,
        deadline: datumData.deadline,
        expiry_buffer: datumData.expiry_buffer,
        fee_address: datumData.fee_address,
        min_charge: datumData.min_charge,
      };

      // Update the crowdfund in the database
      updateCrowdfund.mutate({
        id: crowdfund.id,
        datum: JSON.stringify(updatedDatum),
      });

      toast({
        title: "Withdrawal successful!",
        description: `You've withdrawn ${amount} ADA from ${crowdfundName}`,
      });

      setAmount("");
      onSuccess?.();
    } catch (error) {
      console.log("error", error);

      toast({
        title: "Withdrawal failed",
        description:
          "There was an error processing your withdrawal. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Withdraw from {crowdfundName}
        </CardTitle>
        <CardDescription>
          As the crowdfund owner, you can withdraw raised funds to your wallet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription>
            Only the crowdfund owner can withdraw funds. This action is
            irreversible.
          </AlertDescription>
        </Alert>

        <div className="flex items-center justify-between rounded-lg bg-muted p-3">
          <span className="text-sm font-medium">Total Raised:</span>
          <Badge variant="secondary" className="text-lg">
            {totalRaised} ADA
          </Badge>
        </div>

        <div className="space-y-2">
          <label htmlFor="withdraw-amount" className="text-sm font-medium">
            Withdrawal Amount (ADA)
          </label>
          <Input
            id="withdraw-amount"
            type="number"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            max={withdrawableAmount / 1000000}
            step="1"
            className="text-lg"
          />
        </div>

        <div className="space-y-1 text-sm text-muted-foreground">
          <p>• Maximum withdrawal: {withdrawableAmount / 1000000} ADA</p>
          <p>• Transaction fees apply (~0.17 ADA)</p>
          <p>• Withdrawal will be sent to your connected wallet</p>
        </div>

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Warning:</strong> Withdrawing funds will reduce the
            available balance for the crowdfund. Make sure this aligns with your
            project's funding needs.
          </AlertDescription>
        </Alert>

        <Button
          onClick={handleWithdraw}
          disabled={
            isWithdrawing ||
            !amount ||
            parseFloat(amount) <= 0 ||
            parseFloat(amount) > totalRaised
          }
          className="w-full"
          size="lg"
          variant="destructive"
        >
          {isWithdrawing ? (
            <>
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
              Processing...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Withdraw {amount ? `${amount} ADA` : ""}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
