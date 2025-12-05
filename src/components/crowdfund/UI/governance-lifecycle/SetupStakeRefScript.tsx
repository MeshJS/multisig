"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { api } from "@/utils/api";

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
      console.log("[SetupStakeRefScript] Crowdfund updated with stake reference script");
      
      // Invalidate all crowdfund-related queries to trigger refetch
      if (crowdfundId) {
        await utils.crowdfund.getCrowdfundById.invalidate({ id: crowdfundId });
      }
      await utils.crowdfund.getCrowdfundsByProposerKeyHash.invalidate();
      await utils.crowdfund.getAllCrowdfunds.invalidate();
      await utils.crowdfund.getPublicCrowdfunds.invalidate();
      
      console.log("[SetupStakeRefScript] Invalidated crowdfund queries to refresh UI");
    },
    onError: (err) => {
      console.error("[SetupStakeRefScript] Error updating crowdfund:", err);
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
      const signedTx = await wallet.signTx(tx, true);
      const txHash = await wallet.submitTx(signedTx);

      console.log("[SetupStakeRefScript] Stake reference script transaction submitted:", txHash);

      // Update the crowdfund in the database with the stake reference script
      // Stake reference script is attached to output 0 in setupStakeRefScript
      if (crowdfundId && txHash) {
        try {
          await updateCrowdfund.mutateAsync({
            id: crowdfundId,
            stakeRefScript: JSON.stringify({
              txHash: txHash,
              outputIndex: 0,
            }),
          });
          console.log("[SetupStakeRefScript] Crowdfund updated with stake reference script");
        } catch (updateError) {
          console.error("[SetupStakeRefScript] Failed to update crowdfund:", updateError);
          toast({
            title: "Warning",
            description: "Stake reference script transaction submitted but database update failed. You may need to manually update the crowdfund.",
            variant: "destructive",
          });
        }
      }

      // Update the contract instance with the new stake reference script
      contract.setRefStakeTxHash(txHash, 0);

      toast({
        title: "Stake reference script setup successfully",
        description: `Transaction submitted: ${txHash.substring(0, 16)}...`,
      });

      // Wait a moment for state to update, then call success callback
      setTimeout(() => {
        onSuccess?.();
      }, 500);
    } catch (error: any) {
      console.error("[SetupStakeRefScript] Error:", error);
      toast({
        title: "Failed to setup stake reference script",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-2 border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Settings2 className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          Setup Required: Stake Reference Script
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30">
          <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          <AlertDescription className="text-sm">
            Before proceeding with governance actions, you need to set up the stake reference script. 
            This is a one-time setup that attaches the stake validator script to a transaction output.
          </AlertDescription>
        </Alert>

        <div className="space-y-2 text-sm text-muted-foreground">
          <p>This step will:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Create a transaction with the stake validator script</li>
            <li>Attach the script to output 0</li>
            <li>Store the reference in the database</li>
          </ul>
        </div>

        <Button
          onClick={handleSetupStakeRefScript}
          disabled={isLoading}
          className="w-full bg-orange-600 hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Setting up Stake Reference Script...
            </>
          ) : (
            <>
              <Settings2 className="mr-2 h-4 w-4" />
              Setup Stake Reference Script
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

