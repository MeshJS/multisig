"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Unlock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { VotedDatumTS } from "../../crowdfund";
import { api } from "@/utils/api";
import { useCollateralToast } from "../useCollateralToast";
import { getProvider } from "@/utils/get-provider";

interface DeregisterCertsProps {
  contract: MeshCrowdfundContract;
  datum: VotedDatumTS;
  crowdfundId?: string;
  onSuccess?: () => void;
}

export function DeregisterCerts({
  contract,
  datum,
  crowdfundId,
  onSuccess,
}: DeregisterCertsProps) {
  const { toast } = useToast();
  const { wallet } = useWallet();
  const [isLoading, setIsLoading] = useState(false);

  const { handleError: handleCollateralError, ensureCollateral } = useCollateralToast({
    proposerKeyHash: "",
    governance: contract.governance,
  });

  const updateCrowdfund = api.crowdfund.updateCrowdfund.useMutation();

  const refundTotal =
    contract.governance.stakeRegisterDeposit +
    contract.governance.drepRegisterDeposit +
    contract.governance.govDeposit;

  const handleDeregisterCerts = async () => {
    if (!wallet) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet first.",
        variant: "destructive",
      });
      return;
    }

    // Check deadline
    const currentTime = Math.floor(Date.now() / 1000);
    if (datum.deadline > currentTime) {
      toast({
        title: "Too early",
        description: `Deadline: ${new Date(datum.deadline * 1000).toLocaleString()}`,
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

      const { tx } = await contract.deregisterGovAction({ datum });
      const networkId = await wallet.getNetworkId();
      const provider = getProvider(networkId);
      const signedTx = await wallet.signTx(tx, true);
      const txHash = await provider.submitTx(signedTx);

      if (crowdfundId) {
        try {
          await updateCrowdfund.mutateAsync({
            id: crowdfundId,
            govState: 4,
          });
        } catch (error) {
          console.error("[DeregisterCerts] Failed to update govState:", error);
        }
      }

      toast({
        title: "Certificates deregistered",
        description: `Refund: ${(refundTotal / 1_000_000).toFixed(0)} ADA`,
      });

      onSuccess?.();
    } catch (error: any) {
      console.error("[DeregisterCerts] Error:", error);
      if (!handleCollateralError(error)) {
        toast({
          title: "Failed to deregister",
          description: error.message || "An error occurred",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground text-center">
        Refund: {(refundTotal / 1_000_000).toFixed(0)} ADA
      </div>
      <Button 
        onClick={handleDeregisterCerts} 
        disabled={isLoading} 
        className="w-full"
        variant="default"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Deregistering...
          </>
        ) : (
          <>
            <Unlock className="mr-2 h-4 w-4" />
            Complete & Refund
          </>
        )}
      </Button>
    </div>
  );
}
