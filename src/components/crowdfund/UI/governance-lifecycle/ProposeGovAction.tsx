"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { CrowdfundDatumTS } from "../../crowdfund";
import type { GovernanceAction } from "@meshsdk/common";
import { api } from "@/utils/api";
import { useCollateralToast } from "../useCollateralToast";
import { getProvider } from "@/utils/get-provider";

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

  const { handleError: handleCollateralError, ensureCollateral } = useCollateralToast({
    proposerKeyHash: "",
    governance: contract.governance,
  });
  
  const updateCrowdfund = api.crowdfund.updateCrowdfund.useMutation();

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
      // Check for collateral before attempting transaction
      const hasCollateral = await ensureCollateral();
      if (!hasCollateral) {
        setIsLoading(false);
        return; // Toast already shown by ensureCollateral
      }

      const govAnchor = anchorGovAction || contract.governance.anchorGovAction;
      if (!govAnchor?.url || !govAnchor?.hash) {
        throw new Error("Governance anchor is required");
      }

      const normalizedGovAction: GovernanceAction = {
        kind: "InfoAction",
        action: {},
      };

      const { tx } = await contract.proposeGovAction({
        datum,
        anchorGovAction,
        governanceAction: normalizedGovAction,
      });
      
      const networkId = await wallet.getNetworkId();
      const provider = getProvider(networkId);
      const signedTx = await wallet.signTx(tx, true);
      const txHash = await provider.submitTx(signedTx);

      if (crowdfundId) {
        try {
          await updateCrowdfund.mutateAsync({
            id: crowdfundId,
            govActionId: JSON.stringify({
              txHash: txHash,
              index: 0,
            }),
            govState: 2,
            ...(govAnchor && {
              govActionAnchor: JSON.stringify({
                url: govAnchor.url,
                hash: govAnchor.hash,
              }),
            }),
          });
        } catch (error) {
          console.error("[ProposeGovAction] Failed to save:", error);
        }
      }

      toast({
        title: "Governance action proposed",
        description: `Transaction: ${txHash.substring(0, 16)}...`,
      });

      onSuccess?.();
    } catch (error: any) {
      console.error("[ProposeGovAction] Error:", error);
      if (!handleCollateralError(error)) {
        toast({
          title: "Failed to propose",
          description: error.message || "An error occurred",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const deposit = contract.governance.govDeposit / 1_000_000;

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground text-center">
        Deposit: {deposit.toFixed(0)} ADA
      </div>
      <Button 
        onClick={handleProposeGovAction} 
        disabled={isLoading} 
        className="w-full"
        variant="default"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Proposing...
          </>
        ) : (
          <>
            <FileText className="mr-2 h-4 w-4" />
            Propose Action
          </>
        )}
      </Button>
    </div>
  );
}
