"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { RegisteredCertsDatumTS } from "../../crowdfund";
import type { GovernanceAction } from "@meshsdk/common";

type GovernanceAnchor = {
  url: string;
  hash: string;
};

interface ProposeGovActionProps {
  contract: MeshCrowdfundContract;
  datum: RegisteredCertsDatumTS;
  anchorGovAction?: GovernanceAnchor;
  governanceAction?: GovernanceAction;
  onSuccess?: () => void;
}

export function ProposeGovAction({
  contract,
  datum,
  anchorGovAction,
  governanceAction,
  onSuccess,
}: ProposeGovActionProps) {
  const { toast } = useToast();
  const { wallet } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

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

      const { tx } = await contract.proposeGovAction({
        datum,
        anchorGovAction,
        governanceAction,
      });
      const signedTx = await wallet.signTx(tx);
      const txHash = await wallet.submitTx(signedTx);

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
            <strong>RegisteredCerts</strong> to <strong>Proposed</strong> state.
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

