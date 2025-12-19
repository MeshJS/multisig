import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/ui/card-content";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, ExternalLink, Loader, AlertCircle, RefreshCw } from "lucide-react";
import { Wallet } from "@/types/wallet";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { useSiteStore } from "@/lib/zustand/site";
import { toast } from "@/hooks/use-toast";
import { useRouter } from "next/router";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { getBalanceFromUtxos } from "@/utils/getBalance";
import { getProvider } from "@/utils/get-provider";

interface MigrationCompleteStepProps {
  appWallet: Wallet;
  newWalletId: string;
  migrationId?: string | null;
  onBack: () => void;
}

export default function MigrationCompleteStep({ 
  appWallet, 
  newWalletId,
  migrationId,
  onBack 
}: MigrationCompleteStepProps) {
  const { userAddress } = useUserStore();
  const router = useRouter();
  const network = useSiteStore((state) => state.network);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Get wallet UTxOs and pending transactions for validation
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const setWalletsUtxos = useWalletsStore((state) => state.setWalletsUtxos);
  const oldWalletUtxos = walletsUtxos[appWallet.id] || [];
  const oldWalletBalance = getBalanceFromUtxos(oldWalletUtxos);
  const { transactions: pendingTransactions, isLoading: isLoadingPending } = usePendingTransactions({ 
    walletId: appWallet.id 
  });

  // Define mutations
  const { mutateAsync: clearMigrationTarget } = api.wallet.clearMigrationTarget.useMutation();
  const { mutateAsync: archiveWallet } = api.wallet.archiveWallet.useMutation();
  const { mutateAsync: completeMigration } = api.migration.completeMigration.useMutation();
  const utils = api.useUtils();

  // Get new wallet data
  const { data: newWalletData, isLoading: isLoadingNewWallet } = api.wallet.getWallet.useQuery(
    {
      address: userAddress!,
      walletId: newWalletId,
    },
    {
      enabled: !!userAddress && !!newWalletId,
    }
  );

  // Refresh wallet UTxOs to get latest data
  const refreshWalletData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(appWallet.address);
      setWalletsUtxos(appWallet.id, utxos);
      
      // Also refresh pending transactions
      await utils.transaction.getPendingTransactions.invalidate({ walletId: appWallet.id });
    } catch (error) {
      console.error("Failed to refresh wallet data:", error);
      toast({
        title: "Refresh Failed",
        description: "Could not refresh wallet data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [appWallet.address, appWallet.id, network, setWalletsUtxos, utils]);

  // Refresh wallet data on mount to get latest UTxOs
  useEffect(() => {
    refreshWalletData();
  }, [refreshWalletData]);

  // Validate migration completion conditions - simplified: just check if wallet is empty
  useEffect(() => {
    // Only wait for pending transactions to load (critical for validation)
    if (isLoadingPending) {
      setIsValidating(true);
      return;
    }

    // Quick validation - check if wallet is empty
    setIsValidating(false);
    const errors: string[] = [];

    // Check if old wallet has any UTxOs remaining (simplified check)
    if (oldWalletUtxos.length > 0) {
      errors.push("All funds have not been transferred yet. Please wait for the transfer transaction to complete.");
    }

    // Check if there are any pending transactions
    if (pendingTransactions && pendingTransactions.length > 0) {
      errors.push("There are pending transactions. Please complete or cancel them before finishing the migration.");
    }

    setValidationErrors(errors);
  }, [oldWalletUtxos.length, pendingTransactions, isLoadingPending]);

  // Auto-refresh wallet data every 10 seconds if there are errors
  useEffect(() => {
    if (validationErrors.length === 0 || isLoadingPending || isRefreshing) return;

    const interval = setInterval(() => {
      refreshWalletData();
    }, 10000);

    return () => clearInterval(interval);
  }, [validationErrors.length, isLoadingPending, isRefreshing, refreshWalletData]);


  const handleCompleteMigration = async () => {
    setIsCompleting(true);
    try {
      // Mark migration as completed in database (if migrationId exists)
      if (migrationId) {
        await completeMigration({
          migrationId: migrationId,
        });
      }

      // Clear migration target from old wallet
      await clearMigrationTarget({
        walletId: appWallet.id,
      });

      // Archive the old wallet
      await archiveWallet({
        walletId: appWallet.id,
      });

      // Invalidate queries to refresh UI
      await utils.wallet.getWallet.invalidate();
      await utils.wallet.getUserWallets.invalidate();
      await utils.migration.getPendingMigrations.invalidate();
      await utils.migration.getMigrationByOriginalWallet.invalidate();

      toast({
        title: "Migration Complete",
        description: "Your wallet migration has been completed successfully! The old wallet has been archived.",
      });

      // Navigate to the new wallet after a short delay to ensure UI updates
      setTimeout(() => {
        router.push(`/wallets/${newWalletId}/info`);
      }, 500);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      toast({
        title: "Error",
        description: `Failed to complete migration: ${errorMessage}. Please try again or contact support if the issue persists.`,
        variant: "destructive",
      });
    } finally {
      setIsCompleting(false);
    }
  };

  const handleViewNewWallet = () => {
    router.push(`/wallets/${newWalletId}/info`);
  };

  // Only show loading if we're actually waiting for critical data
  if (isLoadingPending) {
    return (
      <CardUI
        title="Validating Migration"
        description="Checking migration completion requirements..."
        cardClassName="col-span-2"
      >
        <div className="flex items-center justify-center py-8">
          <Loader className="h-8 w-8 animate-spin" />
          <span className="ml-2">Checking pending transactions...</span>
        </div>
      </CardUI>
    );
  }
  
  // Show validation state if still validating (should be quick)
  if (isValidating) {
    return (
      <CardUI
        title="Validating Migration"
        description="Checking migration completion requirements..."
        cardClassName="col-span-2"
      >
        <div className="flex items-center justify-center py-8">
          <Loader className="h-8 w-8 animate-spin" />
          <span className="ml-2">Validating migration completion...</span>
        </div>
      </CardUI>
    );
  }

  // Show validation errors if migration is not ready to complete
  if (validationErrors.length > 0) {
    return (
      <CardUI
        title="Migration Not Ready"
        description="Please wait for all transfers to complete before finishing migration"
        cardClassName="col-span-2"
      >
        <div className="space-y-4">
          <Alert className="border-amber-200/50 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/20">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-amber-800 dark:text-amber-200">
              <strong>Migration Cannot Be Completed Yet</strong>
              <ul className="mt-2 list-disc list-inside space-y-1">
                {validationErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>

          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-3">
            <h4 className="font-medium">Current Status</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <div className="text-muted-foreground">Remaining UTxOs</div>
                <div className="text-lg font-semibold">{oldWalletUtxos.length}</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground">Pending Transactions</div>
                <div className="text-lg font-semibold">{pendingTransactions?.length || 0}</div>
              </div>
            </div>
            {oldWalletBalance !== undefined && oldWalletBalance > 0 && (
              <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Remaining Balance:</span>
                  <span className="font-medium">{oldWalletBalance.toFixed(2)} ADA</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onBack}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              onClick={refreshWalletData}
              disabled={isRefreshing}
              className="flex-1"
            >
              {isRefreshing ? (
                <>
                  <Loader className="h-4 w-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh Status
                </>
              )}
            </Button>
          </div>
        </div>
      </CardUI>
    );
  }

  return (
    <div className="space-y-6">
      <CardUI
        title="Migration Complete"
        description="Your wallet has been successfully migrated"
        cardClassName="col-span-2"
      >
        <div className="space-y-6">
          <div className="text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Migration Successful!
            </h3>
            <p className="text-gray-600 dark:text-gray-300">
              Your wallet has been successfully migrated to a new configuration.
            </p>
          </div>

          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
            <h4 className="font-medium text-green-900 dark:text-green-100 mb-2">What's Next?</h4>
            <ul className="text-sm text-green-800 dark:text-green-200 space-y-1">
              <li>• Your new wallet is ready to use</li>
              <li>• All funds have been transferred</li>
              <li>• Proxy settings have been updated</li>
              <li>• Old wallet will be archived</li>
              <li>• You can now use your new wallet for transactions</li>
            </ul>
          </div>

          {newWalletData && (
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
              <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">New Wallet Details</h4>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium">Name:</span> {newWalletData.name}
                </div>
                <div>
                  <span className="font-medium">Address:</span> 
                  <span className="font-mono text-xs ml-2 break-all">
                    {newWalletData.signersAddresses?.[0] || "N/A"}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Signers:</span> {newWalletData.signersAddresses?.length || 0}
                </div>
                <div>
                  <span className="font-medium">Required Signatures:</span> {newWalletData.numRequiredSigners || 1}
                </div>
              </div>
            </div>
          )}

          <Alert className="border-blue-200/50 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-900/20">
            <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertDescription className="text-blue-800 dark:text-blue-200">
              <strong>Important:</strong> Your old wallet will be archived after migration completion. 
              You can continue using your new wallet for all future transactions.
            </AlertDescription>
          </Alert>
        </div>

        <div className="flex gap-3 pt-4">
          <Button
            variant="outline"
            onClick={onBack}
            className="flex-1"
          >
            Back to Overview
          </Button>
          <Button
            onClick={handleViewNewWallet}
            className="flex-1"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            View New Wallet
          </Button>
          <Button
            onClick={handleCompleteMigration}
            disabled={isCompleting}
            className="flex-1"
          >
            {isCompleting ? (
              <>
                <Loader className="h-4 w-4 mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Complete Migration
              </>
            )}
          </Button>
        </div>
      </CardUI>
    </div>
  );
}
