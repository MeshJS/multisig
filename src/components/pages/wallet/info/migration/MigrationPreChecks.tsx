import React, { useState, useEffect } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/ui/card-content";
import { AlertCircle, CheckCircle, Loader, ArrowRight, ExternalLink } from "lucide-react";
import { Wallet } from "@/types/wallet";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { useSiteStore } from "@/lib/zustand/site";
import { useProxyStore } from "@/lib/zustand/proxy";
import { getProvider } from "@/utils/get-provider";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { MultisigWallet } from "@/utils/multisigSDK";
import Link from "next/link";

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
  const proxies = useProxyStore((state) => state.proxies[appWallet.id] || []);
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
      // Failed to build multisig wallet - will be handled by staking check
      return null;
    }
  }, [appWallet, network]);

  // Check DRep registration
  useEffect(() => {
    async function checkDRepStatus() {
      try {
        // Check for active proxy DRep (allowed)
        const hasActiveProxyDrep = proxies.some((proxy: any) => proxy.drepInfo?.active === true);
        
        // Check for active direct DRep (not allowed - must be retired)
        const hasActiveDirectDrep = drepInfo?.active === true;
        
        if (hasActiveDirectDrep) {
          // Direct DRep is active - this blocks migration
          setDrepCheck({
            status: "error",
            message: "Direct DRep registration is active",
            details: "You must retire your direct DRep registration before migrating. Only proxy DRep registrations are allowed during migration."
          });
        } else if (hasActiveProxyDrep) {
          // Only proxy DRep is active - this is allowed
          setDrepCheck({
            status: "success",
            message: "Proxy DRep is registered",
            details: "You have an active proxy DRep registration, which is allowed for migration."
          });
        } else {
          // No DRep registration
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
  }, [drepInfo, proxies]);

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
        return "border-green-200/50 bg-green-50 dark:border-green-800/50 dark:bg-green-900/20";
      case "warning":
        return "border-yellow-200/50 bg-yellow-50 dark:border-yellow-800/50 dark:bg-yellow-900/20";
      case "error":
        return "border-red-200/50 bg-red-50 dark:border-red-800/50 dark:bg-red-900/20";
      default:
        return "border-gray-200/50 bg-gray-50 dark:border-gray-700/50 dark:bg-gray-800";
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-1">Step 1: Pre-Checks</h3>
        <p className="text-sm text-muted-foreground">Review your wallet status before starting migration</p>
      </div>
      <div className="space-y-6">
        {/* DRep Check */}
        <div 
          className={`p-4 border rounded-lg transition-all duration-200 ${getStatusColor(drepCheck.status)}`}
          role="status"
          aria-live="polite"
          aria-label={`DRep Registration: ${drepCheck.status === "loading" ? "Checking" : drepCheck.status === "success" ? "Ready" : drepCheck.status === "warning" ? "Warning" : "Error"}`}
        >
          <div className="flex items-start gap-3">
            {drepCheck.status === "loading" ? (
              <Loader className="h-4 w-4 animate-spin text-muted-foreground mt-0.5" />
            ) : (
              <div className="mt-0.5">{getStatusIcon(drepCheck.status)}</div>
            )}
            <div className="flex-1">
              <h4 className="font-medium">DRep Registration</h4>
              <p className="text-sm text-muted-foreground">{drepCheck.message}</p>
              {drepCheck.details && (
                <p className="text-xs text-muted-foreground mt-1">{drepCheck.details}</p>
              )}
              {drepCheck.status === "error" && (
                <div className="mt-3">
                  <Link href={`/wallets/${appWallet.id}/governance`}>
                    <Button variant="outline" size="sm" className="w-full sm:w-auto">
                      <ExternalLink className="h-3 w-3 mr-2" />
                      Go to Governance to Retire DRep
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Staking Check */}
        <div 
          className={`p-4 border rounded-lg transition-all duration-200 ${getStatusColor(stakingCheck.status)}`}
          role="status"
          aria-live="polite"
          aria-label={`Staking Registration: ${stakingCheck.status === "loading" ? "Checking" : stakingCheck.status === "success" ? "Ready" : stakingCheck.status === "warning" ? "Warning" : "Error"}`}
        >
          <div className="flex items-center gap-3">
            {stakingCheck.status === "loading" ? (
              <Loader className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              getStatusIcon(stakingCheck.status)
            )}
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
        <div 
          className={`p-4 border rounded-lg transition-all duration-200 ${getStatusColor(pendingTxCheck.status)}`}
          role="status"
          aria-live="polite"
          aria-label={`Pending Transactions: ${pendingTxCheck.status === "loading" ? "Checking" : pendingTxCheck.status === "success" ? "Ready" : pendingTxCheck.status === "warning" ? "Warning" : "Error"}`}
        >
          <div className="flex items-center gap-3">
            {pendingTxCheck.status === "loading" ? (
              <Loader className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              getStatusIcon(pendingTxCheck.status)
            )}
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
          <Alert className={hasErrors ? "border-red-200/50 bg-red-50 dark:border-red-800/50 dark:bg-red-900/20" : "border-yellow-200/50 bg-yellow-50 dark:border-yellow-800/50 dark:bg-yellow-900/20"}>
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
        <div className="flex gap-3 pt-6 border-t border-border/30">
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
            aria-label={hasErrors ? "Cannot continue: Some checks failed" : allChecksComplete ? "Continue to wallet creation" : "Waiting for checks to complete"}
          >
            {allChecksComplete ? (
              <>
                Continue to Wallet Creation
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            ) : (
              <>
                <Loader className="h-4 w-4 animate-spin mr-2" />
                Checking...
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
