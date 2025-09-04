import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Coins, Send, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getProvider } from "@/utils/get-provider";
import { useWallet } from "@meshsdk/react";
import { MeshTxBuilder } from "@meshsdk/core";
import { MeshCrowdfundContract } from "../offchain";
import { CrowdfundDatumTS } from "../../crowdfund";
import { api } from "@/utils/api";
import { useSiteStore } from "@/lib/zustand/site";

interface ContributeToCrowdfundProps {
  crowdfund: any;
  onSuccess?: () => void;
}

export function ContributeToCrowdfund({ 
  crowdfund, 
  onSuccess 
}: ContributeToCrowdfundProps) {
  const [amount, setAmount] = useState("");
  const [isContributing, setIsContributing] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const { toast } = useToast();
  const { connected, wallet } = useWallet();
  const network = useSiteStore((state) => state.network);
  const datumData = JSON.parse(crowdfund.datum);
  
  // Add the updateCrowdfund mutation
  const updateCrowdfund = api.crowdfund.updateCrowdfund.useMutation({
    onSuccess: () => {
      toast({
        title: "Crowdfund updated successfully",
        description: "The crowdfund data has been updated with your contribution.",
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

  // Fetch wallet balance
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!wallet) return;
        const utxos = await wallet.getUtxos();
        if (!cancelled) {
          const totalLovelace = utxos.reduce((total, utxo) => {
            const lovelaceAmount = utxo.output.amount.find(
              (a: any) => a.unit === "lovelace"
            )?.quantity;
            return total + (lovelaceAmount ? Number(lovelaceAmount) : 0);
          }, 0);
          setWalletBalance(totalLovelace);
        }
      } catch (e) {
        console.error("Failed to get wallet balance:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet]);

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

  const handleContribute = async () => {
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

    // Validate amount
    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid contribution amount.",
      });
      return;
    }

    setIsContributing(true);
    
    try {
      // Check wallet balance before attempting transaction
      const contributionAmount = Number(amount) * 1000000;
      const estimatedFees = 200000; // 0.2 ADA estimate
      const totalRequired = contributionAmount + estimatedFees;

      if (walletBalance < totalRequired) {
        toast({
          title: "Insufficient funds",
          description: `You have ${(walletBalance / 1000000).toFixed(2)} ADA but need at least ${(totalRequired / 1000000).toFixed(2)} ADA (contribution + fees)`,
          variant: "destructive",
        });
        return;
      }

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

      const { tx } = await contract.contributeCrowdfund(contributionAmount, datumData);

      // Sign and submit the transaction
      const signedTx = await wallet.signTx(tx);
      const txHash = await wallet.submitTx(signedTx);


      // Update the datum with the new values
      const updatedDatum: CrowdfundDatumTS = {
        completion_script: datumData.completion_script,
        share_token: datumData.share_token,
        crowdfund_address: datumData.crowdfund_address,
        fundraise_target: datumData.fundraise_target,
        current_fundraised_amount: datumData.current_fundraised_amount + contributionAmount,
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
        title: "Contribution successful!",
        description: `You've contributed ${amount} ADA to ${crowdfund.name} (txHash: ${txHash})`,
      });
      
      setAmount("");
      onSuccess?.();
    } catch (error: any) {
      console.log("error", error);
      
      // Handle specific error types
      let errorMessage = "There was an error processing your contribution. Please try again.";
      
      if (error.message?.includes("Insufficient funds")) {
        errorMessage = error.message;
      } else if (error.message?.includes("Not enough funds")) {
        errorMessage = "Insufficient funds to complete the transaction. Please ensure you have enough ADA for the contribution plus transaction fees (~0.2 ADA).";
      } else if (error.message?.includes("No UTXOs")) {
        errorMessage = "No UTXOs found in your wallet. Please ensure your wallet has ADA.";
      }
      
      toast({
        title: "Contribution failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsContributing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="w-5 h-5" />
          Contribute to {crowdfund.name}
        </CardTitle>
        <CardDescription>
          Support this crowdfunding campaign by contributing ADA. You'll receive share tokens proportional to your contribution.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Contributions are processed on the Cardano blockchain. Make sure you have sufficient ADA in your wallet.
          </AlertDescription>
        </Alert>
        
        <div className="space-y-2">
          <label htmlFor="amount" className="text-sm font-medium">
            Contribution Amount (ADA)
          </label>
          <Input
            id="amount"
            type="number"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min={datumData.min_charge / 1000000}
            step="1"
            className="text-lg"
          />
        </div>

        <div className="text-sm text-muted-foreground">
          <p>• Your wallet balance: {(walletBalance / 1000000).toFixed(2)} ADA</p>
          <p>• Minimum contribution: {datumData.min_charge / 1000000} ADA</p>
          <p>• You'll receive share tokens based on your contribution</p>
          <p>• Transaction fees apply (~0.17 ADA)</p>
        </div>

        <Button 
          onClick={handleContribute}
          disabled={isContributing || !amount || parseFloat(amount) <= 0}
          className="w-full"
          size="lg"
        >
          {isContributing ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Processing...
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              Contribute {amount ? `${amount} ADA` : ''}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
