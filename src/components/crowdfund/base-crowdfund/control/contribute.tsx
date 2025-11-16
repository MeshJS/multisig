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
import { Coins, Send, AlertCircle, Clock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getProvider } from "@/utils/get-provider";
import { useWallet } from "@meshsdk/react";
import { LargestFirstInputSelector, MeshTxBuilder } from "@meshsdk/core";
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
  onSuccess,
}: ContributeToCrowdfundProps) {
  const [amount, setAmount] = useState<string>("");
  const [isContributing, setIsContributing] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const { toast } = useToast();
  const { connected, wallet } = useWallet();
  const network = useSiteStore((state) => state.network);

  // Check if this is a draft crowdfund
  const isDraft = !crowdfund.authTokenId;

  if (isDraft) {
    return (
      <div className="p-6 text-center">
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <div className="mb-2 flex items-center justify-center gap-2 text-yellow-800">
            <Clock className="h-5 w-5" />
            <span className="font-medium">Draft Crowdfund</span>
          </div>
          <p className="text-sm text-yellow-700">
            This crowdfund is still in draft mode and cannot accept
            contributions yet.
          </p>
        </div>
      </div>
    );
  }

  const datumData = JSON.parse(crowdfund.datum);

  // For governance-extended crowdfunds, check if deposits need to be added to the target
  const govExtension =
    crowdfund.govExtension ||
    (crowdfund.govDatum ? JSON.parse(crowdfund.govDatum) : null);

  // Calculate remaining funding amount
  const currentRaised = datumData.current_fundraised_amount || 0;
  let fundingTarget = datumData.fundraise_target || 0;

  // For governance crowdfunds, if the target doesn't include deposits, add them
  if (govExtension) {
    const stakeDeposit = govExtension.stake_register_deposit ? Number(govExtension.stake_register_deposit) : 0;
    const drepDeposit = govExtension.drep_register_deposit ? Number(govExtension.drep_register_deposit) : 0;
    const totalDeposits = stakeDeposit + drepDeposit;

    // If the funding target is less than deposits, it means deposits weren't added yet
    // Add deposits to get the total funding target
    if (fundingTarget < totalDeposits) {
      fundingTarget = fundingTarget + totalDeposits;
    }
  }

  const remainingFunding = Math.max(0, fundingTarget - currentRaised);
  const remainingFundingADA = remainingFunding / 1000000;

  // Calculate max contribution (limited by remaining funding, wallet balance, and fees)
  const estimatedFees = 200000; // 0.2 ADA in lovelace
  const maxFromWallet = Math.max(0, walletBalance - estimatedFees);
  const maxContribution = Math.max(
    datumData.min_charge / 1000000,
    Math.min(
      remainingFundingADA,
      maxFromWallet / 1000000,
      walletBalance / 1000000,
    ),
  );
  const minContribution = datumData.min_charge / 1000000;

  // Initialize amount with minimum if empty
  useEffect(() => {
    if (!amount && minContribution > 0 && maxContribution >= minContribution) {
      setAmount(minContribution.toFixed(2));
    }
  }, [minContribution, maxContribution, amount]);

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
              (a: any) => a.unit === "lovelace",
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
      selector: new LargestFirstInputSelector(),
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

      const parsedParamUtxo = JSON.parse(crowdfund.paramUtxo);
      console.log("[handleContribute] Creating contract", {
        proposerKeyHash: crowdfund.proposerKeyHashR0,
        paramUtxo: parsedParamUtxo,
        paramUtxoType: typeof parsedParamUtxo,
        hasInput: "input" in parsedParamUtxo,
        hasTxHash: "txHash" in parsedParamUtxo,
        storedAddress: crowdfund.address,
        datumData,
      });

      const contract = new MeshCrowdfundContract(
        {
          mesh: meshTxBuilder,
          fetcher: provider,
          wallet: wallet,
          networkId: network,
        },
        {
          proposerKeyHash: crowdfund.proposerKeyHashR0,
          paramUtxo: parsedParamUtxo,
        },
      );

      // Validate that the computed address matches the stored address
      const computedAddress = contract.crowdfundAddress;
      console.log("[handleContribute] Address validation", {
        computedAddress,
        storedAddress: crowdfund.address,
        addressesMatch: computedAddress === crowdfund.address,
      });

      if (computedAddress && computedAddress !== crowdfund.address) {
        console.warn(
          "[handleContribute] Address mismatch! Using stored address.",
          {
            computed: computedAddress,
            stored: crowdfund.address,
          },
        );
        // Override with stored address to ensure consistency
        contract.crowdfundAddress = crowdfund.address;
      } else if (!computedAddress && crowdfund.address) {
        // If address wasn't computed but we have a stored one, use it
        contract.crowdfundAddress = crowdfund.address;
        console.log(
          "[handleContribute] Using stored address as computed address was not set",
        );
      }

      console.log("[handleContribute] Calling contributeCrowdfund", {
        contributionAmount,
        datumData,
        crowdfundAddress: contract.crowdfundAddress,
      });

      const { tx } = await contract.contributeCrowdfund(
        contributionAmount,
        datumData,
      );

      console.log("[handleContribute] Transaction built successfully", {
        txLength: tx.length,
      });

      // Sign and submit the transaction
      const signedTx = await wallet.signTx(tx, true);
      const txHash = await wallet.submitTx(signedTx);

      // Update the datum with the new values
      const updatedDatum: CrowdfundDatumTS = {
        completion_script: datumData.completion_script,
        share_token: datumData.share_token,
        crowdfund_address: datumData.crowdfund_address,
        fundraise_target: datumData.fundraise_target,
        current_fundraised_amount:
          datumData.current_fundraised_amount + contributionAmount,
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
      let errorMessage =
        "There was an error processing your contribution. Please try again.";

      if (error.message?.includes("Insufficient funds")) {
        errorMessage = error.message;
      } else if (error.message?.includes("Not enough funds")) {
        errorMessage =
          "Insufficient funds to complete the transaction. Please ensure you have enough ADA for the contribution plus transaction fees (~0.2 ADA).";
      } else if (error.message?.includes("No UTXOs")) {
        errorMessage =
          "No UTXOs found in your wallet. Please ensure your wallet has ADA.";
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
          <Coins className="h-5 w-5" />
          Contribute to {crowdfund.name}
        </CardTitle>
        <CardDescription>
          Support this crowdfunding campaign by contributing ADA. You'll receive
          share tokens proportional to your contribution.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Contributions are processed on the Cardano blockchain. Make sure you
            have sufficient ADA in your wallet.
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="amount" className="text-sm font-medium">
              Contribution Amount (ADA)
            </label>
            <div className="flex items-center gap-3">
              <input
                id="amount"
                type="range"
                min={minContribution}
                max={maxContribution}
                step="0.1"
                value={amount || minContribution.toString()}
                onChange={(e) =>
                  setAmount(parseFloat(e.target.value).toFixed(2))
                }
                disabled={maxContribution <= minContribution}
                className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:shadow-md [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:shadow-md"
                style={{
                  background:
                    maxContribution > minContribution
                      ? `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((parseFloat(amount || minContribution.toString()) - minContribution) / (maxContribution - minContribution)) * 100}%, #e5e7eb ${((parseFloat(amount || minContribution.toString()) - minContribution) / (maxContribution - minContribution)) * 100}%, #e5e7eb 100%)`
                      : "#3b82f6",
                }}
              />
              <Input
                type="number"
                min={minContribution}
                max={maxContribution}
                step="0.1"
                value={amount || ""}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "") {
                    setAmount("");
                    return;
                  }
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue)) {
                    // Clamp value between min and max
                    const clampedValue = Math.max(
                      minContribution,
                      Math.min(maxContribution, numValue),
                    );
                    setAmount(clampedValue.toFixed(2));
                  }
                }}
                onBlur={(e) => {
                  // Ensure value is within bounds on blur
                  const numValue = parseFloat(e.target.value);
                  if (isNaN(numValue) || numValue < minContribution) {
                    setAmount(minContribution.toFixed(2));
                  } else if (numValue > maxContribution) {
                    setAmount(maxContribution.toFixed(2));
                  } else {
                    setAmount(numValue.toFixed(2));
                  }
                }}
                className="w-24 text-center text-lg"
                placeholder={minContribution.toFixed(2)}
              />
              <span className="w-10 text-sm text-muted-foreground">ADA</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{minContribution.toFixed(2)} ADA</span>
              <span>{maxContribution.toFixed(2)} ADA max</span>
            </div>
          </div>

          {/* Quick amount buttons */}
          {maxContribution > minContribution && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(minContribution.toFixed(2))}
              >
                Min ({minContribution.toFixed(2)})
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount((maxContribution / 4).toFixed(2))}
              >
                25%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount((maxContribution / 2).toFixed(2))}
              >
                50%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount((maxContribution * 0.75).toFixed(2))}
              >
                75%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(maxContribution.toFixed(2))}
              >
                Max
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            • Your wallet balance: {(walletBalance / 1000000).toFixed(2)} ADA
          </p>
          <p>• Minimum contribution: {minContribution.toFixed(2)} ADA</p>
          <p>
            • Remaining funding needed: {remainingFundingADA.toFixed(2)} ADA
          </p>
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
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
              Processing...
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Contribute {amount ? `${amount} ADA` : ""}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
