"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { api } from "@/utils/api";
import { getProvider } from "@/utils/get-provider";

interface SetupStakeRefScriptProps {
  contract: MeshCrowdfundContract;
  crowdfundId: string;
  onSuccess?: () => void;
}

export function SetupStakeRefScript({
  contract,
  crowdfundId,
  onSuccess,
}: SetupStakeRefScriptProps) {
  const { toast } = useToast();
  const { wallet } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const utils = api.useUtils();

  const updateCrowdfund = api.crowdfund.updateCrowdfund.useMutation({
    onSuccess: async () => {
      if (crowdfundId) {
        await utils.crowdfund.getCrowdfundById.invalidate({ id: crowdfundId });
      }
      await utils.crowdfund.getAllCrowdfunds.invalidate();
    },
  });

  const handleSetupStakeRefScript = async () => {
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
      const { tx } = await contract.setupStakeRefScript();
      const networkId = await wallet.getNetworkId();
      const provider = getProvider(networkId);
      const signedTx = await wallet.signTx(tx, true);
      const txHash = await provider.submitTx(signedTx);

      if (crowdfundId && txHash) {
        try {
          await updateCrowdfund.mutateAsync({
            id: crowdfundId,
            stakeRefScript: JSON.stringify({
              txHash: txHash,
              outputIndex: 0,
            }),
          });
        } catch (updateError) {
          console.error("[SetupStakeRefScript] Failed to update:", updateError);
        }
      }

      contract.setRefStakeTxHash(txHash, 0);

      toast({
        title: "Stake reference script setup",
        description: `Transaction: ${txHash.substring(0, 16)}...`,
      });

      setTimeout(() => onSuccess?.(), 500);
    } catch (error: any) {
      console.error("[SetupStakeRefScript] Error:", error);
      toast({
        title: "Setup failed",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground text-center">
        One-time setup required
      </div>
      <Button 
        onClick={handleSetupStakeRefScript} 
        disabled={isLoading} 
        className="w-full bg-slate-700 hover:bg-slate-800 text-white shadow-md hover:shadow-lg transition-all duration-200"
        variant="default"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Setting up...
          </>
        ) : (
          <>
            <Settings2 className="mr-2 h-4 w-4" />
            Setup Reference Script
          </>
        )}
      </Button>
    </div>
  );
}
