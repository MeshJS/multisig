import React, { useState, useEffect } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/ui/card-content";
import { AlertCircle, CheckCircle, Loader, ArrowRight } from "lucide-react";
import { Wallet } from "@/types/wallet";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { MultisigWallet } from "@/utils/multisigSDK";

interface PreCheckResult {
  status: "loading" | "success" | "warning" | "error";
  message: string;
  details?: string;
}

interface MigrationPreChecksProps {
  appWallet: Wallet;
  onContinue: () => void;
  onCancel: () => void;
}

export default function MigrationPreChecks({ 
  appWallet, 
  onContinue, 
  onCancel 
}: MigrationPreChecksProps) {
  const network = useSiteStore((state) => state.network);
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const { transactions: pendingTransactions } = usePendingTransactions({
    walletId: appWallet.id,
  });

  const [drepCheck, setDrepCheck] = useState<PreCheckResult>({ status: "loading", message: "Checking DRep registration..." });
  const [stakingCheck, setStakingCheck] = useState<PreCheckResult>({ status: "loading", message: "Checking staking registration..." });
  const [pendingTxCheck, setPendingTxCheck] = useState<PreCheckResult>({ status: "loading", message: "Checking pending transactions..." });

  // Build multisig wallet to get stake address
  const multisigWallet = React.useMemo(() => {
    if (!appWallet) return null;
    try {
      return new MultisigWallet(
        appWallet.name,
        appWallet.signersAddresses.map((addr, i) => ({
          keyHash: addr,
          role: 0,
          name: appWallet.signersDescriptions[i] || "",
        })),
        appWallet.description || "",
        appWallet.numRequiredSigners || 1,
        network
      );
    } catch (error) {
      console.error("Failed to build multisig wallet:", error);
      return null;
    }
  }, [appWallet, network]);

  // Check DRep registration
  useEffect(() => {
    async function checkDRepStatus() {
      try {
        if (drepInfo) {
          setDrepCheck({
            status: drepInfo.active ? "warning" : "success",
            message: drepInfo.active ? "DRep is registered" : "DRep is not registered",
            details: drepInfo.active 
              ? "You have an active DRep registration. Consider updating your DRep registration after migration."
              : "No DRep registration found."
          });
        } else {
          setDrepCheck({
            status: "success",
            message: "DRep is not registered",
            details: "No DRep registration found."
          });
        }
      } catch (error) {
        setDrepCheck({
          status: "error",
          message: "Failed to check DRep status",
          details: "Could not verify DRep registration status."
        });
      }
    }

    checkDRepStatus();
  }, [drepInfo]);

  // Check staking registration
  useEffect(() => {
    async function checkStakingStatus() {
      try {
        if (!multisigWallet) {
          setStakingCheck({
            status: "error",
            message: "Could not determine stake address",
            details: "Failed to build multisig wallet for staking check."
          });
          return;
        }

        const stakeAddress = multisigWallet.getStakeAddress();
        if (!stakeAddress) {
          setStakingCheck({
            status: "success",
            message: "No stake address configured",
            details: "This wallet does not have staking capabilities."
          });
          return;
        }

        const blockchainProvider = getProvider(network);
        const stakingInfo = await blockchainProvider.get(`/accounts/${stakeAddress}`);
        
        setStakingCheck({
          status: stakingInfo.active ? "warning" : "success",
          message: stakingInfo.active ? "Stake is registered" : "Stake is not registered",
          details: stakingInfo.active 
            ? `Stake is registered to pool: ${stakingInfo.pool_id || "Unknown"}. Consider updating delegation after migration.`
            : "No staking registration found."
        });
      } catch (error) {
        setStakingCheck({
          status: "error",
          message: "Failed to check staking status",
          details: "Could not verify staking registration status."
        });
      }
    }

    checkStakingStatus();
  }, [multisigWallet, network]);

  // Check pending transactions
  useEffect(() => {
    if (pendingTransactions !== undefined) {
      const count = pendingTransactions.length;
      setPendingTxCheck({
        status: count > 0 ? "warning" : "success",
        message: count > 0 ? `${count} pending transaction(s)` : "No pending transactions",
        details: count > 0 
          ? "You have pending transactions that may need to be completed before migration."
          : "No pending transactions found."
      });
    }
  }, [pendingTransactions]);

  const allChecksComplete = drepCheck.status !== "loading" && 
                           stakingCheck.status !== "loading" && 
                           pendingTxCheck.status !== "loading";

  const hasWarnings = drepCheck.status === "warning" || 
                     stakingCheck.status === "warning" || 
                     pendingTxCheck.status === "warning";

  const hasErrors = drepCheck.status === "error" || 
                   stakingCheck.status === "error" || 
                   pendingTxCheck.status === "error";

  const getStatusIcon = (status: PreCheckResult["status"]) => {
    switch (status) {
      case "loading":
        return <Loader className="h-4 w-4 animate-spin" />;
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "warning":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusColor = (status: PreCheckResult["status"]) => {
    switch (status) {
      case "success":
        return "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20";
      case "warning":
        return "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20";
      case "error":
        return "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20";
      default:
        return "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800";
    }
  };

  return (
    <CardUI
      title="Step 1: Pre-Checks"
      description="Review your wallet status before starting migration"
      cardClassName="col-span-2"
    >
      <div className="space-y-6">
        {/* DRep Check */}
        <div className={`p-4 border rounded-lg ${getStatusColor(drepCheck.status)}`}>
          <div className="flex items-center gap-3">
            {getStatusIcon(drepCheck.status)}
            <div className="flex-1">
              <h4 className="font-medium">DRep Registration</h4>
              <p className="text-sm text-muted-foreground">{drepCheck.message}</p>
              {drepCheck.details && (
                <p className="text-xs text-muted-foreground mt-1">{drepCheck.details}</p>
              )}
            </div>
          </div>
        </div>

        {/* Staking Check */}
        <div className={`p-4 border rounded-lg ${getStatusColor(stakingCheck.status)}`}>
          <div className="flex items-center gap-3">
            {getStatusIcon(stakingCheck.status)}
            <div className="flex-1">
              <h4 className="font-medium">Staking Registration</h4>
              <p className="text-sm text-muted-foreground">{stakingCheck.message}</p>
              {stakingCheck.details && (
                <p className="text-xs text-muted-foreground mt-1">{stakingCheck.details}</p>
              )}
            </div>
          </div>
        </div>

        {/* Pending Transactions Check */}
        <div className={`p-4 border rounded-lg ${getStatusColor(pendingTxCheck.status)}`}>
          <div className="flex items-center gap-3">
            {getStatusIcon(pendingTxCheck.status)}
            <div className="flex-1">
              <h4 className="font-medium">Pending Transactions</h4>
              <p className="text-sm text-muted-foreground">{pendingTxCheck.message}</p>
              {pendingTxCheck.details && (
                <p className="text-xs text-muted-foreground mt-1">{pendingTxCheck.details}</p>
              )}
            </div>
          </div>
        </div>

        {/* Summary Alert */}
        {allChecksComplete && (hasWarnings || hasErrors) && (
          <Alert className={hasErrors ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20" : "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20"}>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {hasErrors 
                ? "Some checks failed. Please resolve these issues before proceeding with migration."
                : "Some warnings were found. You can proceed with migration, but consider addressing these items after migration."
              }
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-6 border-t">
          <Button
            variant="outline"
            onClick={onCancel}
            className="flex-1"
          >
            Cancel Migration
          </Button>
          <Button
            onClick={onContinue}
            disabled={!allChecksComplete || hasErrors}
            className="flex-1"
          >
            {allChecksComplete ? (
              <>
                Continue to Wallet Creation
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            ) : (
              "Checking..."
            )}
          </Button>
        </div>
      </div>
    </CardUI>
  );
}
