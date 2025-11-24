"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, Unlock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { VotedDatumTS } from "../../crowdfund";

interface DeregisterCertsProps {
  contract: MeshCrowdfundContract;
  datum: VotedDatumTS;
  onSuccess?: () => void;
}

export function DeregisterCerts({
  contract,
  datum,
  onSuccess,
}: DeregisterCertsProps) {
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

    // Check if deadline has passed
    const currentTime = Math.floor(Date.now() / 1000);
    if (datum.deadline > currentTime) {
      errors.push(
        `Deadline has not passed yet. Deadline: ${new Date(datum.deadline * 1000).toLocaleString()}`,
      );
    }

    // Check reference scripts
    const refSpendUtxo = contract.getRefSpendUtxo();
    if (!refSpendUtxo) {
      errors.push(
        "Spend reference script not set. Make sure the crowdfund has spendRefScript set in the database.",
      );
    }

    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleDeregisterCerts = async () => {
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

      const { tx } = await contract.deregisterGovAction({ datum });
      const signedTx = await wallet.signTx(tx);
      const txHash = await wallet.submitTx(signedTx);

      toast({
        title: "Certificates deregistered successfully",
        description: `Transaction submitted: ${txHash.substring(0, 16)}...`,
      });

      onSuccess?.();
    } catch (error: any) {
      console.error("[DeregisterCerts] Error:", error);
      toast({
        title: "Failed to deregister certificates",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const refundTotal =
    contract.governance.stakeRegisterDeposit +
    contract.governance.drepRegisterDeposit +
    contract.governance.govDeposit;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Unlock className="h-5 w-5 text-orange-500" />
          Step 4: Deregister Certificates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            This step deregisters stake and DRep certificates and refunds all
            deposits after the governance period ends. The crowdfund will
            transition from <strong>Voted</strong> to <strong>Refundable</strong>{" "}
            state.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Stake Registration Deposit Refund:</span>
            <span>
              {(contract.governance.stakeRegisterDeposit / 1_000_000).toFixed(
                2,
              )}{" "}
              ADA
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span>DRep Registration Deposit Refund:</span>
            <span>
              {(contract.governance.drepRegisterDeposit / 1_000_000).toFixed(
                2,
              )}{" "}
              ADA
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Governance Deposit Refund:</span>
            <span>
              {(contract.governance.govDeposit / 1_000_000).toFixed(2)} ADA
            </span>
          </div>
          <div className="flex justify-between text-sm font-semibold border-t pt-2">
            <span>Total Refund:</span>
            <span>{(refundTotal / 1_000_000).toFixed(2)} ADA</span>
          </div>
        </div>

        <div className="text-sm text-muted-foreground">
          <p>
            Deadline: {new Date(datum.deadline * 1000).toLocaleString()}
          </p>
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
          onClick={handleDeregisterCerts}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Deregistering Certificates...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Deregister Certificates
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

