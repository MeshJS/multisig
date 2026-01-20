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
import { Wallet, Download, AlertTriangle, Shield, Clock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@meshsdk/react";
import { Asset, MeshTxBuilder, UTxO } from "@meshsdk/core";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";
import { MeshCrowdfundContract } from "../offchain";
import { CrowdfundDatumTS } from "../crowdfund";
import { api } from "@/utils/api";
import { mapGovExtensionToConfig, parseGovDatum } from "./utils";
import { env } from "@/env";
import { useCollateralToast } from "./useCollateralToast";

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
  
  // Check if this is a draft crowdfund
  const isDraft = !crowdfund.authTokenId;
  
  if (isDraft) {
    return (
      <div className="p-6 text-center">
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-center justify-center gap-2 text-yellow-800 mb-2">
            <Clock className="w-5 h-5" />
            <span className="font-medium">Draft Crowdfund</span>
          </div>
          <p className="text-sm text-yellow-700">
            This crowdfund is still in draft mode and has no funds to withdraw.
          </p>
        </div>
      </div>
    );
  }
  
  const datumData = JSON.parse(crowdfund.datum);
  const govExtension =
    crowdfund.govExtension ?? parseGovDatum(crowdfund.govDatum);
  const totalRaised = datumData.current_fundraised_amount / 1000000;
  const crowdfundName = crowdfund.name;
  const shareToken = datumData.share_token;
  const { connected, wallet } = useWallet();
  const network = useSiteStore((state) => state.network);

  const [withdrawableUtxo, setWithdrawableUtxo] = useState<UTxO>();
  const [withdrawableAmount, setWithdrawableAmount] = useState<number>(0);

  // Governance config for collateral toast
  const governanceConfigForCollateral = useMemo(() => {
    if (!govExtension) {
      return {
        delegatePoolId: "",
        govActionPeriod: 6,
        stakeRegisterDeposit: 2000000,
        drepRegisterDeposit: 500000000,
        govDeposit: 100000000000,
      };
    }
    return mapGovExtensionToConfig(govExtension);
  }, [govExtension]);

  const { handleError: handleCollateralError, ensureCollateral } = useCollateralToast({
    proposerKeyHash: "",
    governance: governanceConfigForCollateral,
  });

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
      evaluator: provider,
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
      // Check for collateral before attempting transaction
      const hasCollateral = await ensureCollateral();
      if (!hasCollateral) {
        setIsWithdrawing(false);
        return; // Toast already shown by ensureCollateral
      }

      if (!govExtension) {
        throw new Error("Governance extension data not found for this crowdfund.");
      }

      const governanceConfig = mapGovExtensionToConfig(govExtension);

      // Extract govActionType and treasuryBeneficiaries from gov_action
      let govActionType: 'InfoAction' | 'TreasuryWithdrawalsAction' = 'InfoAction';
      let treasuryBeneficiaries: Array<{ address: string; amount: string }> | undefined = undefined;
      
      if (govExtension.gov_action && typeof govExtension.gov_action === 'object') {
        const govAction = govExtension.gov_action as any;
        if (govAction.kind === 'TreasuryWithdrawalsAction' || govAction.type === 'treasury_withdrawals') {
          govActionType = 'TreasuryWithdrawalsAction';
          // Extract beneficiaries from the action
          if (govAction.action?.withdrawals) {
            const withdrawals = govAction.action.withdrawals;
            treasuryBeneficiaries = Object.entries(withdrawals).map(([address, amount]) => ({
              address,
              amount: String(amount),
            }));
          } else if (govAction.metadata?.beneficiaries) {
            // Fallback to metadata beneficiaries if withdrawals not in action
            const beneficiaries = Array.isArray(govAction.metadata.beneficiaries)
              ? govAction.metadata.beneficiaries
              : [];
            treasuryBeneficiaries = beneficiaries
              .filter((b: any) => b.address && b.amount)
              .map((b: any) => ({
                address: b.address,
                amount: String(b.amount),
              }));
          }
        } else if (govAction.kind === 'InfoAction' || govAction.type === 'info' || !govAction.kind) {
          govActionType = 'InfoAction';
        }
      }

      // Parse reference scripts if available
      let spendRefScript: { txHash: string; outputIndex: number } | undefined = undefined;
      let stakeRefScript: { txHash: string; outputIndex: number } | undefined = undefined;
      
      if (crowdfund.spendRefScript) {
        try {
          const parsed = JSON.parse(crowdfund.spendRefScript);
          if (parsed && parsed.txHash && typeof parsed.outputIndex === 'number') {
            spendRefScript = parsed;
            console.log("[handleWithdraw] Successfully parsed spendRefScript from DB:", spendRefScript);
          } else {
            console.warn("[handleWithdraw] Invalid spendRefScript format:", parsed);
          }
        } catch (e) {
          console.error("[handleWithdraw] Failed to parse spendRefScript:", e);
        }
      } else {
        console.error("[handleWithdraw] No spendRefScript found in database for crowdfund:", crowdfund.id);
        throw new Error(
          `Crowdfund ${crowdfund.id} does not have a spendRefScript set in the database. ` +
          `The reference script must be set during crowdfund setup.`
        );
      }
      
      if (crowdfund.stakeRefScript) {
        try {
          const parsed = JSON.parse(crowdfund.stakeRefScript);
          if (parsed && parsed.txHash && typeof parsed.outputIndex === 'number') {
            stakeRefScript = parsed;
          } else {
            console.warn("[handleWithdraw] Invalid stakeRefScript format:", parsed);
          }
        } catch (e) {
          console.error("[handleWithdraw] Failed to parse stakeRefScript:", e);
        }
      }

      console.log("[handleWithdraw] Creating contract", {
        proposerKeyHash: crowdfund.proposerKeyHashR0,
        paramUtxo: JSON.parse(crowdfund.paramUtxo),
        governance: governanceConfig,
        spendRefScript,
        stakeRefScript,
        govActionType,
        hasTreasuryBeneficiaries: !!treasuryBeneficiaries,
        treasuryBeneficiariesCount: treasuryBeneficiaries?.length,
      });

      const contract = new MeshCrowdfundContract(
        {
          mesh: meshTxBuilder,
          fetcher: provider,
          evaluator: provider,
          wallet: wallet,
          networkId: network,
        },
        {
          proposerKeyHash: crowdfund.proposerKeyHashR0,
          paramUtxo: JSON.parse(crowdfund.paramUtxo),
          governance: governanceConfig,
          spendRefScript,
          stakeRefScript,
          refAddress: env.NEXT_PUBLIC_REF_ADDR,
          govActionType,
          treasuryBeneficiaries,
        },
      );

      const { tx } = await contract.withdrawCrowdfund(
        withdrawAmount,
        datumData,
      );

      // Sign and submit the transaction
      const signedTx = await wallet.signTx(tx);
      const txHash = await wallet.submitTx(signedTx);

      // Update the datum with the new values
      const updatedDatum: CrowdfundDatumTS = {
        stake_script: datumData.stake_script,
        share_token: datumData.share_token,
        crowdfund_address: datumData.crowdfund_address,
        fundraise_target: datumData.fundraise_target,
        current_fundraised_amount:
          datumData.current_fundraised_amount - withdrawAmount,
        allow_over_subscription: datumData.allow_over_subscription,
        deadline: datumData.deadline,
        expiry_buffer: datumData.expiry_buffer,
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
    } catch (error: any) {
      console.log("error", error);

      // Check if it's a collateral error and show special toast
      if (handleCollateralError(error)) {
        // Collateral error was handled
        return;
      }

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
          Withdraw funds you previously contributed. Your maximum withdrawal is limited by your share tokens.
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
          <span className="text-sm font-medium">Total Raised (campaign):</span>
          <Badge variant="secondary" className="text-lg">
            {totalRaised.toLocaleString()} ADA
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
          <p>• Your maximum withdrawal: {withdrawableAmount / 1000000} ADA</p>
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
            parseFloat(amount) > (withdrawableAmount / 1000000)
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
