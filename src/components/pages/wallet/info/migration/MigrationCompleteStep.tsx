import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/ui/card-content";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, ExternalLink, Loader, AlertCircle } from "lucide-react";
import { Wallet } from "@/types/wallet";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { toast } from "@/hooks/use-toast";
import { useRouter } from "next/router";

interface MigrationCompleteStepProps {
  appWallet: Wallet;
  newWalletId: string;
  onBack: () => void;
}

export default function MigrationCompleteStep({ 
  appWallet, 
  newWalletId,
  onBack 
}: MigrationCompleteStepProps) {
  const { userAddress } = useUserStore();
  const router = useRouter();
  const [isCompleting, setIsCompleting] = useState(false);

  // Define mutations
  const { mutateAsync: clearMigrationTarget } = api.wallet.clearMigrationTarget.useMutation();
  const { mutateAsync: archiveWallet } = api.wallet.archiveWallet.useMutation();
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

  const handleCompleteMigration = async () => {
    setIsCompleting(true);
    try {
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

      toast({
        title: "Migration Complete",
        description: "Your wallet migration has been completed successfully! The old wallet has been archived.",
      });

      // Navigate to the new wallet
      router.push(`/wallets/${newWalletId}/info`);
    } catch (error) {
      console.error("Failed to complete migration:", error);
      toast({
        title: "Error",
        description: "Failed to complete migration. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCompleting(false);
    }
  };

  const handleViewNewWallet = () => {
    router.push(`/wallets/${newWalletId}/info`);
  };

  if (isLoadingNewWallet) {
    return (
      <CardUI
        title="Loading New Wallet"
        description="Loading your new wallet information..."
        cardClassName="col-span-2"
      >
        <div className="flex items-center justify-center py-8">
          <Loader className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading new wallet...</span>
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
