"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, ThumbsUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { ProposedDatumTS } from "../../crowdfund";
import { api } from "@/utils/api";
import { useCollateralToast } from "../useCollateralToast";
import { getProvider } from "@/utils/get-provider";

interface VoteOnGovActionProps {
  contract: MeshCrowdfundContract;
  datum: ProposedDatumTS;
  crowdfundId?: string;
  onSuccess?: () => void;
}

export function VoteOnGovAction({
  contract,
  datum,
  crowdfundId,
  onSuccess,
}: VoteOnGovActionProps) {
  const { toast } = useToast();
  const { wallet } = useWallet();
  const [isLoading, setIsLoading] = useState(false);

  const { handleError: handleCollateralError, ensureCollateral } = useCollateralToast({
    proposerKeyHash: "",
    governance: contract.governance,
  });

  const updateCrowdfund = api.crowdfund.updateCrowdfund.useMutation();

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
      // Check for collateral before attempting transaction
      const hasCollateral = await ensureCollateral();
      if (!hasCollateral) {
        setIsLoading(false);
        return; // Toast already shown by ensureCollateral
      }

      const { tx } = await contract.voteOnGovAction({
        datum,
        voteKind: "Yes",
      });
      const networkId = await wallet.getNetworkId();
      const provider = getProvider(networkId);
      const signedTx = await wallet.signTx(tx, true);
      const txHash = await provider.submitTx(signedTx);

      if (crowdfundId) {
        try {
          await updateCrowdfund.mutateAsync({
            id: crowdfundId,
            govState: 3,
          });
        } catch (error) {
          console.error("[VoteOnGovAction] Failed to update govState:", error);
        }
      }

      toast({
        title: "Vote submitted",
        description: `Transaction: ${txHash.substring(0, 16)}...`,
      });

      onSuccess?.();
    } catch (error: any) {
      console.error("[VoteOnGovAction] Error:", error);
      if (!handleCollateralError(error)) {
        toast({
          title: "Failed to submit vote",
          description: error.message || "An error occurred",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button 
      onClick={handleVote} 
      disabled={isLoading} 
      className="w-full"
      variant="default"
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Voting...
        </>
      ) : (
        <>
          <ThumbsUp className="mr-2 h-4 w-4" />
          Vote Yes
        </>
      )}
    </Button>
  );
}
