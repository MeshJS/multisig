import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/ui/card-content";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, ArrowRight, Loader, AlertCircle, CheckCircle, Users } from "lucide-react";
import { Wallet } from "@/types/wallet";
import { api } from "@/utils/api";
import { toast } from "@/hooks/use-toast";

interface ProxyTransferStepProps {
  appWallet: Wallet;
  newWalletId: string;
  onBack: () => void;
  onContinue: () => void;
}

export default function ProxyTransferStep({ 
  appWallet, 
  newWalletId,
  onBack, 
  onContinue
}: ProxyTransferStepProps) {
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferComplete, setTransferComplete] = useState(false);

  // Get existing proxies for the current wallet
  const { data: existingProxies, isLoading: isLoadingProxies } = api.proxy.getProxiesByUserOrWallet.useQuery({
    walletId: appWallet.id,
  });

  // Mutation to transfer proxies
  const { mutate: transferProxies } = api.proxy.transferProxies.useMutation({
    onSuccess: () => {
      setTransferComplete(true);
      toast({
        title: "Proxies Transferred",
        description: "All proxy registrations have been transferred to the new wallet.",
      });
      // Automatically proceed to the next step after a short delay
      setTimeout(() => {
        onContinue();
      }, 2000);
    },
    onError: (error) => {
      console.error("Failed to transfer proxies:", error);
      toast({
        title: "Transfer Failed",
        description: "Failed to transfer proxy registrations. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleTransferProxies = async () => {
    if (!existingProxies || existingProxies.length === 0) return;

    setIsTransferring(true);
    try {
      await transferProxies({
        fromWalletId: appWallet.id,
        toWalletId: newWalletId,
      });
    } catch (error) {
      console.error("Failed to transfer proxies:", error);
    } finally {
      setIsTransferring(false);
    }
  };

  if (isLoadingProxies) {
    return (
      <CardUI
        title="Loading Proxies"
        description="Checking for existing proxy registrations..."
        cardClassName="col-span-2"
      >
        <div className="flex items-center justify-center py-8">
          <Loader className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading proxy information...</span>
        </div>
      </CardUI>
    );
  }

  const hasProxies = existingProxies && existingProxies.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <CardUI
        title="Step 5: Transfer Proxies"
        description="Move proxy registrations to the new wallet"
        cardClassName="col-span-2"
      >
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This will transfer all proxy registrations from your current wallet to the new wallet.
            This ensures your governance participation continues seamlessly.
          </AlertDescription>
        </Alert>
      </CardUI>

      {/* Proxy Information */}
      <CardUI
        title="Current Proxy Registrations"
        description="Proxies to be transferred"
      >
        <div className="space-y-4">
          {hasProxies ? (
            <div className="space-y-3">
              {existingProxies.map((proxy, index) => (
                <div key={proxy.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-blue-500" />
                    <div>
                      <h4 className="font-medium">Proxy {index + 1}</h4>
                      <p className="text-sm text-muted-foreground">
                        {proxy.name || `Proxy ${index + 1}`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">Active</p>
                    <p className="text-xs text-muted-foreground">Will be transferred</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
              <CheckCircle className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              <div>
                <h4 className="font-medium">No Proxies Found</h4>
                <p className="text-sm text-muted-foreground">
                  There are no proxy registrations to transfer. You can continue to the next step.
                </p>
              </div>
            </div>
          )}
        </div>
      </CardUI>

      {/* New Wallet Information */}
      <CardUI
        title="New Wallet"
        description="Destination for the proxy registrations"
      >
        <div className="space-y-4">
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium mb-2">Transfer Details</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">From Wallet:</span>
                <span className="font-medium">{appWallet.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">To Wallet:</span>
                <span className="font-medium">New Migrated Wallet</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Proxies to Transfer:</span>
                <span className="font-medium">{existingProxies?.length || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </CardUI>

      {/* Transfer Status */}
      {transferComplete && (
        <CardUI
          title="Transfer Complete"
          description="Proxy registrations have been transferred"
        >
          <div className="flex items-center gap-3 p-4 border rounded-lg bg-green-50 dark:bg-green-900/20">
            <CheckCircle className="h-5 w-5 text-green-500 dark:text-green-400" />
            <div>
              <h4 className="font-medium">Proxies Transferred</h4>
              <p className="text-sm text-muted-foreground">
                All proxy registrations have been successfully transferred to the new wallet.
                You can now complete the migration.
              </p>
            </div>
          </div>
        </CardUI>
      )}

      {/* Action Buttons */}
      <CardUI
        title="Transfer Proxies"
        description="Complete the proxy transfer"
        cardClassName="col-span-2"
      >
        <div className="flex gap-3 border-t pt-4">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Fund Transfer
          </Button>
          {!transferComplete ? (
            <Button
              onClick={handleTransferProxies}
              disabled={isTransferring || !hasProxies}
              className="flex-1"
            >
              {isTransferring ? (
                <>
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                  Transferring Proxies...
                </>
              ) : hasProxies ? (
                <>
                  <Users className="mr-2 h-4 w-4" />
                  Transfer Proxies
                </>
              ) : (
                <>
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Continue (No Proxies)
                </>
              )}
            </Button>
          ) : (
            <Button disabled className="flex-1">
              <Loader className="mr-2 h-4 w-4 animate-spin" />
              Proceeding to Next Step...
            </Button>
          )}
        </div>
      </CardUI>
    </div>
  );
}
