"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Settings, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { CrowdfundDatumTS } from "../../crowdfund";
import { getProvider } from "@/utils/get-provider";
import { api } from "@/utils/api";
import DRepSetupForm from "../DRepSetupForm";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useCollateralToast } from "../useCollateralToast";

type GovernanceAnchor = {
  url: string;
  hash: string;
};

interface RegisterCertsProps {
  contract: MeshCrowdfundContract;
  datum: CrowdfundDatumTS;
  anchorDrep?: GovernanceAnchor;
  crowdfundId?: string;
  onSuccess?: () => void;
  onAnchorDrepCreated?: (anchorUrl: string, anchorHash: string) => void;
}

export function RegisterCerts({
  contract,
  datum,
  anchorDrep,
  crowdfundId,
  onSuccess,
  onAnchorDrepCreated,
}: RegisterCertsProps) {
  const { toast } = useToast();
  const { wallet, connected } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [localAnchorDrep, setLocalAnchorDrep] = useState<GovernanceAnchor | undefined>(anchorDrep);
  const [showDRepSetup, setShowDRepSetup] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string>("");

  const { handleError: handleCollateralError, ensureCollateral } = useCollateralToast({
    proposerKeyHash: datum.crowdfund_address ? "" : "", // Will be populated from contract
    governance: contract.governance,
  });

  const updateCrowdfund = api.crowdfund.updateCrowdfund.useMutation();

  useEffect(() => {
    if (anchorDrep && !localAnchorDrep) {
      setLocalAnchorDrep(anchorDrep);
    }
  }, [anchorDrep, localAnchorDrep]);

  // Get wallet address for DRepSetupForm
  useEffect(() => {
    const getAddress = async () => {
      if (wallet && connected) {
        try {
          const address = await wallet.getChangeAddress();
          setWalletAddress(address);
        } catch (error) {
          console.error("[RegisterCerts] Failed to get wallet address:", error);
        }
      }
    };
    getAddress();
  }, [wallet, connected]);

  const handleRegisterCerts = async () => {
    if (!wallet) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet first.",
        variant: "destructive",
      });
      return;
    }

    const currentAnchorDrep = localAnchorDrep || anchorDrep;
    if (!currentAnchorDrep?.url || !currentAnchorDrep?.hash) {
      toast({
        title: "DRep anchor required",
        description: "Please set up DRep metadata first.",
        variant: "destructive",
      });
      setShowDRepSetup(true);
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

      const { tx } = await contract.registerCerts({
        datum,
        anchorDrep: currentAnchorDrep,
      });
      const networkId = await wallet.getNetworkId();
      const provider = getProvider(networkId);

      const signedTx = await wallet.signTx(tx, true);
      const txHash = await provider.submitTx(signedTx);

      if (crowdfundId) {
        try {
          await updateCrowdfund.mutateAsync({
            id: crowdfundId,
            govState: 1,
          });
        } catch (error) {
          console.error("[RegisterCerts] Failed to update govState:", error);
        }
      }

      toast({
        title: "Certificates registered",
        description: `Transaction: ${txHash.substring(0, 16)}...`,
      });

      onSuccess?.();
    } catch (error: any) {
      console.error("[RegisterCerts] Error:", error);
      // Check if it's a collateral error and show special toast
      if (!handleCollateralError(error)) {
        toast({
          title: "Failed to register",
          description: error.message || "An error occurred",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDRepAnchorCreated = async (anchorUrl: string, anchorHash: string) => {
    const anchorData: GovernanceAnchor = { url: anchorUrl, hash: anchorHash };
    setLocalAnchorDrep(anchorData);
    setShowDRepSetup(false);

    if (crowdfundId) {
      try {
        await updateCrowdfund.mutateAsync({
          id: crowdfundId,
          drepAnchor: JSON.stringify(anchorData),
        });
      } catch (error) {
        console.error("[RegisterCerts] Failed to save DRep anchor:", error);
      }
    }

    onAnchorDrepCreated?.(anchorUrl, anchorHash);
    toast({
      title: "DRep metadata created",
      description: "Ready to register certificates.",
    });
  };

  const currentAnchorDrep = localAnchorDrep || anchorDrep;
  const deposit = (contract.governance.stakeRegisterDeposit + contract.governance.drepRegisterDeposit) / 1_000_000;

  return (
    <div className="space-y-3">
      {!currentAnchorDrep && (
        <Collapsible open={showDRepSetup} onOpenChange={setShowDRepSetup}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-between mb-2">
              <span>Setup DRep Metadata (Required)</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showDRepSetup ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border rounded-lg p-4 mb-3">
            {walletAddress ? (
              <DRepSetupForm
                appWallet={{ address: walletAddress } as any}
                onAnchorCreated={handleDRepAnchorCreated}
              />
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4">
                Please connect your wallet to set up DRep metadata.
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="text-xs text-muted-foreground text-center">
        Deposit: {deposit.toFixed(0)} ADA
      </div>
      
      <Button 
        onClick={handleRegisterCerts} 
        disabled={isLoading || !currentAnchorDrep} 
        className="w-full"
        variant="default"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Registering...
          </>
        ) : (
          <>
            <Settings className="mr-2 h-4 w-4" />
            Register Certificates
          </>
        )}
      </Button>
    </div>
  );
}
