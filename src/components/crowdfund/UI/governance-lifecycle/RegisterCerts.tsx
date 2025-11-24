"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { CrowdfundDatumTS } from "../../crowdfund";
type GovernanceAnchor = {
  url: string;
  hash: string;
};
import { api } from "@/utils/api";

interface RegisterCertsProps {
  contract: MeshCrowdfundContract;
  datum: CrowdfundDatumTS;
  anchorDrep?: GovernanceAnchor;
  onSuccess?: () => void;
}

export function RegisterCerts({
  contract,
  datum,
  anchorDrep,
  onSuccess,
}: RegisterCertsProps) {
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

    // Check if crowdfund has sufficient funds
    try {
      // We'll validate this in the actual transaction call
      // For now, just check that we can access the contract
    } catch (error) {
      errors.push(`Failed to validate contract: ${error}`);
    }

    // Validate pool ID format
    if (
      !contract.governance.delegatePoolId ||
      contract.governance.delegatePoolId.length < 56
    ) {
      errors.push(
        `Invalid pool ID format. Expected 56+ characters, got ${contract.governance.delegatePoolId?.length || 0}`,
      );
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

    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleRegisterCerts = async () => {
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

      const { tx } = await contract.registerCerts({ datum, anchorDrep });
      console.log(tx);
      const signedTx = await wallet.signTx(tx, true);
      const txHash = await wallet.submitTx(signedTx);

      toast({
        title: "Certificates registered successfully",
        description: `Transaction submitted: ${txHash.substring(0, 16)}...`,
      });

      onSuccess?.();
    } catch (error: any) {
      console.error("[RegisterCerts] Error:", error);
      toast({
        title: "Failed to register certificates",
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
          <Info className="h-5 w-5 text-blue-500" />
          Step 1: Register Certificates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            This step registers stake and DRep certificates, delegates stake to
            a pool, and locks deposits. The crowdfund will transition from{" "}
            <strong>Crowdfund</strong> to <strong>RegisteredCerts</strong>{" "}
            state.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Stake Registration Deposit:</span>
            <span>
              {(contract.governance.stakeRegisterDeposit / 1_000_000).toFixed(
                2,
              )}{" "}
              ADA
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span>DRep Registration Deposit:</span>
            <span>
              {(contract.governance.drepRegisterDeposit / 1_000_000).toFixed(
                2,
              )}{" "}
              ADA
            </span>
          </div>
          <div className="flex justify-between text-sm font-semibold border-t pt-2">
            <span>Total Deposit:</span>
            <span>
              {(
                (contract.governance.stakeRegisterDeposit +
                  contract.governance.drepRegisterDeposit) /
                1_000_000
              ).toFixed(2)}{" "}
              ADA
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
          onClick={handleRegisterCerts}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Registering Certificates...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Register Certificates
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

