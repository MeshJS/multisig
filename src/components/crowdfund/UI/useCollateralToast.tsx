"use client";

import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, ShieldAlert, Coins, CheckCircle2, Clock } from "lucide-react";
import { useState, useCallback, useEffect, useRef } from "react";
import { useWallet } from "@meshsdk/react";
import { MeshTxBuilder } from "@meshsdk/core";
import { getProvider } from "@/utils/get-provider";
import { MeshCrowdfundContract, GovernanceConfig } from "../offchain";
import { useSiteStore } from "@/lib/zustand/site";

// Check if an error is a collateral-related error
export const isCollateralError = (error: any): boolean => {
  const errorMessage = error?.message || error?.toString() || "";
  const collateralPatterns = [
    "collateral",
    "Collateral",
    "no collateral",
    "No collateral",
    "collateral utxo",
    "Collateral UTxO",
  ];
  return collateralPatterns.some((pattern) =>
    errorMessage.toLowerCase().includes(pattern.toLowerCase())
  );
};

// Component to show transaction confirmation progress
function TxConfirmationProgress({ 
  txHash, 
  networkId,
  onConfirmed,
  onError 
}: { 
  txHash: string;
  networkId: number;
  onConfirmed: () => void;
  onError: (error: any) => void;
}) {
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(1);
  const [status, setStatus] = useState<'waiting' | 'confirmed' | 'error'>('waiting');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const WAIT_TIME = 30000; // 30 seconds
  const PROGRESS_INTERVAL = 100; // Update every 100ms
  
  useEffect(() => {
    let startTime = Date.now();
    
    // Progress bar animation
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / WAIT_TIME) * 100, 100);
      setProgress(newProgress);
    }, PROGRESS_INTERVAL);
    
    // Check for tx confirmation
    const checkTx = async () => {
      try {
        const provider = getProvider(networkId);
        const txInfo = await provider.fetchTxInfo(txHash);
        
        if (txInfo) {
          setStatus('confirmed');
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
          setProgress(100);
          onConfirmed();
        }
      } catch (e) {
        // Tx not found yet, continue waiting
        console.log(`[TxConfirmation] Attempt ${attempt}: Tx not found yet`);
      }
    };
    
    // Check immediately and then every 2 seconds
    checkTx();
    checkIntervalRef.current = setInterval(checkTx, 2000);
    
    // After 10 seconds, reset and try again
    const resetTimeout = setTimeout(() => {
      if (status === 'waiting') {
        setAttempt(prev => prev + 1);
        setProgress(0);
        startTime = Date.now();
      }
    }, WAIT_TIME);
    
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
      clearTimeout(resetTimeout);
    };
  }, [txHash, networkId, attempt, status, onConfirmed]);
  
  return (
    <div className="flex flex-col gap-3 mt-2">
      <div className="flex items-center gap-2">
        {status === 'confirmed' ? (
          <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
        ) : (
          <Clock className="h-5 w-5 text-amber-500 animate-pulse flex-shrink-0" />
        )}
        <span className="text-sm font-medium text-foreground">
          {status === 'confirmed' 
            ? 'Collateral setup complete!' 
            : `Confirming transaction${attempt > 1 ? ` (attempt ${attempt})` : ''}...`
          }
        </span>
      </div>
      
      <div className="space-y-2">
        <Progress 
          value={progress} 
          className={`h-2.5 ${status === 'confirmed' ? 'bg-green-100 dark:bg-green-900/30' : ''}`}
        />
        <div className="flex justify-between items-center text-xs">
          <span className="text-muted-foreground font-mono">
            {txHash.substring(0, 16)}...
          </span>
          <span className="text-muted-foreground font-medium">
            {Math.round(progress)}%
          </span>
        </div>
      </div>
      
      {status === 'confirmed' && (
        <div className="mt-1 p-2.5 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/50 rounded-md">
          <p className="text-sm text-green-700 dark:text-green-300 font-medium">
            ✓ Your collateral is ready. You can now proceed with your transaction.
          </p>
        </div>
      )}
    </div>
  );
}

interface UseCollateralToastOptions {
  proposerKeyHash: string;
  governance: GovernanceConfig;
}

export function useCollateralToast(options: UseCollateralToastOptions) {
  const { toast, dismiss } = useToast();
  const { wallet, connected } = useWallet();
  const networkId = useSiteStore((state) => state.network);
  const [isSettingUp, setIsSettingUp] = useState(false);

  // Check if collateral exists without throwing an error
  const checkCollateral = useCallback(async (): Promise<boolean> => {
    if (!wallet || !connected) {
      return false;
    }

    try {
      const collateral = await wallet.getCollateral();
      return collateral && collateral.length > 0;
    } catch (error) {
      console.log("[checkCollateral] No collateral found:", error);
      return false;
    }
  }, [wallet, connected]);

  const setupCollateral = useCallback(async () => {
    if (!wallet || !connected) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet first.",
        variant: "destructive",
      });
      return;
    }

    setIsSettingUp(true);
    try {
      const provider = getProvider(networkId);
      const meshTxBuilder = new MeshTxBuilder({
        fetcher: provider,
        evaluator: provider,
        submitter: provider,
        verbose: false,
      });
      
      const contract = new MeshCrowdfundContract(
        { mesh: meshTxBuilder, fetcher: provider, evaluator: provider, wallet, networkId },
        {
          proposerKeyHash: options.proposerKeyHash,
          governance: options.governance,
        }
      );

      const { tx } = await contract.setupCollateral();
      const signedTx = await wallet.signTx(tx);
      const txHash = await provider.submitTx(signedTx);

      // Dismiss the original toast and show confirmation progress
      dismiss();
      
      toast({
        title: (
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />
            <span>Setting Up Collateral</span>
          </div>
        ),
        description: (
          <TxConfirmationProgress
            txHash={txHash}
            networkId={networkId}
            onConfirmed={() => {
              // Toast will auto-dismiss or user can close it
            }}
            onError={(error) => {
              console.error("[TxConfirmation] Error:", error);
            }}
          />
        ),
        duration: 120000, // 120 seconds max (allows for multiple 30s attempts)
        className: "w-full max-w-full md:max-w-full", // Use full width
      });

    } catch (error: any) {
      console.error("[setupCollateral] Error:", error);
      toast({
        title: (
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            <span>Collateral Setup Failed</span>
          </div>
        ),
        description: (
          <div className="space-y-1.5 mt-1">
            <p className="text-sm">
              {error.message || "An unexpected error occurred while setting up collateral."}
            </p>
            <p className="text-xs text-muted-foreground">
              Please check your wallet connection and try again.
            </p>
          </div>
        ),
        variant: "destructive",
        duration: 10000,
      });
    } finally {
      setIsSettingUp(false);
    }
  }, [wallet, connected, networkId, options, toast, dismiss]);

  const showCollateralToast = useCallback(
    (originalError?: any) => {
      toast({
        title: (
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            <span>Collateral Required</span>
          </div>
        ),
        description: (
          <div className="flex flex-col gap-3 mt-2">
            <p className="text-sm text-foreground/90 leading-relaxed">
              Your wallet needs collateral UTxOs to interact with smart contracts. This is a one-time setup that enables secure transactions.
            </p>
            <div className="flex items-start gap-2.5 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-3 py-2.5">
              <Coins className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div className="flex-1 space-y-0.5">
                <div className="font-medium text-foreground">
                  Estimated cost: ~15 ADA
                </div>
                <div className="text-muted-foreground">
                  Creates up to 3 UTxOs × 5 ADA each
                </div>
              </div>
            </div>
            <Button
              size="sm"
              onClick={setupCollateral}
              disabled={isSettingUp}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white font-medium shadow-sm hover:shadow-md transition-all"
            >
              {isSettingUp ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Setting up collateral...
                </>
              ) : (
                <>
                  <ShieldAlert className="mr-2 h-4 w-4" />
                  Set Up Collateral
                </>
              )}
            </Button>
          </div>
        ),
        duration: 60000, // 60 seconds - gives users more time to read and act
      });
    },
    [toast, setupCollateral, isSettingUp]
  );

  // Handle error and show collateral toast if it's a collateral error
  const handleError = useCallback(
    (error: any): boolean => {
      if (isCollateralError(error)) {
        showCollateralToast(error);
        return true; // Error was handled
      }
      return false; // Error was not a collateral error
    },
    [showCollateralToast]
  );

  // Check collateral and show toast if missing, returns true if collateral exists
  const ensureCollateral = useCallback(async (): Promise<boolean> => {
    const hasCollateral = await checkCollateral();
    if (!hasCollateral) {
      showCollateralToast();
      return false;
    }
    return true;
  }, [checkCollateral, showCollateralToast]);

  return {
    showCollateralToast,
    handleError,
    isSettingUp,
    setupCollateral,
    checkCollateral,
    ensureCollateral,
  };
}

// Standalone function to create collateral (for use without the hook)
export async function createCollateralUtxos(
  wallet: any,
  networkId: number,
  proposerKeyHash: string,
  governance: GovernanceConfig
): Promise<string> {
  const provider = getProvider(networkId);
  const meshTxBuilder = new MeshTxBuilder({
    fetcher: provider,
    evaluator: provider,
    submitter: provider,
    verbose: false,
  });
  
  const contract = new MeshCrowdfundContract(
    { mesh: meshTxBuilder, fetcher: provider, evaluator: provider, wallet, networkId },
    { proposerKeyHash, governance }
  );

  const { tx } = await contract.setupCollateral();
  const signedTx = await wallet.signTx(tx);
  const txHash = await provider.submitTx(signedTx);
  return txHash;
}
