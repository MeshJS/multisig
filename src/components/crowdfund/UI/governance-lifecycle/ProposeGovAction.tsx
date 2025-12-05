"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, FileText, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { CrowdfundDatumTS } from "../../crowdfund";
import type { GovernanceAction } from "@meshsdk/common";
import { api } from "@/utils/api";

type GovernanceAnchor = {
  url: string;
  hash: string;
};

interface ProposeGovActionProps {
  contract: MeshCrowdfundContract;
  datum: CrowdfundDatumTS;
  anchorGovAction?: GovernanceAnchor;
  governanceAction?: GovernanceAction;
  crowdfundId?: string;
  onSuccess?: () => void;
}

export function ProposeGovAction({
  contract,
  datum,
  anchorGovAction,
  governanceAction,
  crowdfundId,
  onSuccess,
}: ProposeGovActionProps) {
  const { toast } = useToast();
  const { wallet } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  
  const updateCrowdfund = api.crowdfund.updateCrowdfund.useMutation({
    onSuccess: () => {
      console.log("[ProposeGovAction] GovAction anchor saved to database");
    },
    onError: (err) => {
      console.error("[ProposeGovAction] Error saving govAction anchor:", err);
    },
  });

  const validate = async () => {
    const errors: string[] = [];

    // Check if wallet is connected
    if (!wallet) {
      errors.push("Wallet not connected");
    }

    // Check reference scripts
    const refSpendUtxo = contract.getRefSpendUtxo();
    if (!refSpendUtxo) {
      errors.push(
        "Spend reference script not set. Make sure the crowdfund has spendRefScript set in the database.",
      );
    }

    const refStakeUtxo = contract.getRefStakeUtxo();
    if (!refStakeUtxo) {
      errors.push(
        "Stake reference script not set. Call setupStakeRefScript first.",
      );
    }

    // Check governance anchor
    const govAnchor =
      anchorGovAction || contract.governance.anchorGovAction;
    if (!govAnchor?.url || !govAnchor?.hash) {
      errors.push("Governance anchor is required");
    }

    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleProposeGovAction = async () => {
    if (!wallet) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet first.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      // Validate before proceeding
      const isValid = await validate();
      if (!isValid) {
        toast({
          title: "Validation failed",
          description: validationErrors.join(", "),
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }

      // Get the final anchor that will be used (may be shortened)
      const govAnchor =
        anchorGovAction || contract.governance.anchorGovAction;
      
      if (!govAnchor?.url || !govAnchor?.hash) {
        throw new Error("Governance anchor is required");
      }

      // Ensure only InfoAction (NicePoll) is used - the validator is parameterized with NicePoll
      // If a different governanceAction is provided, normalize it to InfoAction
      const normalizedGovAction: GovernanceAction = {
        kind: "InfoAction",
        action: {},
      };

      // Warn if a different action type was provided
      if (governanceAction && governanceAction.kind !== "InfoAction") {
        console.warn(
          `[ProposeGovAction] Only InfoAction (NicePoll) is supported. ` +
          `Received ${governanceAction.kind}, using InfoAction instead.`
        );
      }

      const { tx } = await contract.proposeGovAction({
        datum,
        anchorGovAction,
        governanceAction: normalizedGovAction,
      });
      console.log(tx)
      const signedTx = await wallet.signTx(tx);
      const txHash = await wallet.submitTx(signedTx);

      // Save the anchor to the database if crowdfundId is provided
      if (crowdfundId && govAnchor) {
        try {
          await updateCrowdfund.mutateAsync({
            id: crowdfundId,
            govActionAnchor: JSON.stringify({
              url: govAnchor.url,
              hash: govAnchor.hash,
            }),
          });
        } catch (error) {
          console.error("[ProposeGovAction] Failed to save govAction anchor:", error);
          toast({
            title: "Warning",
            description: "Governance action proposed but anchor failed to save to database. Please refresh the page.",
            variant: "destructive",
          });
        }
      }

      toast({
        title: "Governance action proposed successfully",
        description: `Transaction submitted: ${txHash.substring(0, 16)}...`,
      });

      onSuccess?.();
    } catch (error: any) {
      console.error("[ProposeGovAction] Error:", error);
      toast({
        title: "Failed to propose governance action",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-purple-500" />
          Step 2: Propose Governance Action
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            This step submits a governance proposal and locks the governance
            deposit. The crowdfund will transition from{" "}
            <strong>Crowdfund</strong> to <strong>Proposed</strong> state.
          </AlertDescription>
        </Alert>

        <Alert className="bg-blue-50 border-blue-200">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            <strong>Note:</strong> Currently only <strong>Info Action (NicePoll)</strong> is supported.
            This is a governance action that has no effect on-chain, other than an on-chain record.
            The validator is parameterized with NicePoll (VGovernanceAction constructor 6).
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <div className="flex justify-between text-sm font-semibold">
            <span>Governance Deposit:</span>
            <span>
              {(contract.governance.govDeposit / 1_000_000).toFixed(2)} ADA
            </span>
          </div>
        </div>

        {validationErrors.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <ul className="list-disc list-inside space-y-1">
                {validationErrors.map((error, idx) => (
                  <li key={idx}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleProposeGovAction}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Proposing Governance Action...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Propose Governance Action
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

