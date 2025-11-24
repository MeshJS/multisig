"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CheckCircle2, AlertTriangle, Vote } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { ProposedDatumTS } from "../../crowdfund";

type VoteKind = "Yes" | "No" | "Abstain";

interface VoteOnGovActionProps {
  contract: MeshCrowdfundContract;
  datum: ProposedDatumTS;
  onSuccess?: () => void;
}

export function VoteOnGovAction({
  contract,
  datum,
  onSuccess,
}: VoteOnGovActionProps) {
  const { toast } = useToast();
  const { wallet } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [voteKind, setVoteKind] = useState<VoteKind>("Yes");
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

    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleVote = async () => {
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

      const { tx } = await contract.voteOnGovAction({
        datum,
        voteKind,
      });
      const signedTx = await wallet.signTx(tx);
      const txHash = await wallet.submitTx(signedTx);

      toast({
        title: "Vote submitted successfully",
        description: `Transaction submitted: ${txHash.substring(0, 16)}...`,
      });

      onSuccess?.();
    } catch (error: any) {
      console.error("[VoteOnGovAction] Error:", error);
      toast({
        title: "Failed to submit vote",
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
          <Vote className="h-5 w-5 text-green-500" />
          Step 3: Vote on Governance Action
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            This step records your vote on the governance proposal. The
            crowdfund will transition from <strong>Proposed</strong> to{" "}
            <strong>Voted</strong> state. No deposits are locked in this step.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <label className="text-sm font-medium">Vote</label>
          <Select value={voteKind} onValueChange={(v) => setVoteKind(v as VoteKind)}>
            <SelectTrigger>
              <SelectValue placeholder="Select vote" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Yes">Yes</SelectItem>
              <SelectItem value="No">No</SelectItem>
              <SelectItem value="Abstain">Abstain</SelectItem>
            </SelectContent>
          </Select>
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

        <Button onClick={handleVote} disabled={isLoading} className="w-full">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Submitting Vote...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Submit Vote
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

