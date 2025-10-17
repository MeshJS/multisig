import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/ui/card-content";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, ArrowRight, Loader, AlertCircle, CheckCircle, SkipForward } from "lucide-react";
import { Wallet } from "@/types/wallet";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { toast } from "@/hooks/use-toast";
import ProxySetup from "@/components/multisig/proxy/ProxySetup";

interface ProxySetupStepProps {
  appWallet: Wallet;
  newWalletId: string;
  onBack: () => void;
  onContinue: () => void;
}

export default function ProxySetupStep({ 
  appWallet, 
  newWalletId,
  onBack, 
  onContinue 
}: ProxySetupStepProps) {
  const { userAddress } = useUserStore();
  const [isCheckingProxies, setIsCheckingProxies] = useState(true);
  const [hasExistingProxy, setHasExistingProxy] = useState(false);
  const [showProxySetup, setShowProxySetup] = useState(false);
  const [isCreatingProxy, setIsCreatingProxy] = useState(false);

  // Check for existing proxies
  const { data: existingProxies, isLoading: isLoadingProxies } = api.proxy.getProxiesByWallet.useQuery(
    {
      walletId: appWallet.id,
    },
    {
      enabled: !!appWallet.id,
    }
  );

  // Check for new wallet proxies
  const { data: newWalletProxies, isLoading: isLoadingNewProxies } = api.proxy.getProxiesByWallet.useQuery(
    {
      walletId: newWalletId,
    },
    {
      enabled: !!newWalletId,
    }
  );

  React.useEffect(() => {
    if (!isLoadingProxies && !isLoadingNewProxies) {
      setIsCheckingProxies(false);
      setHasExistingProxy((existingProxies?.length || 0) > 0);
    }
  }, [isLoadingProxies, isLoadingNewProxies, existingProxies]);

  const handleSkipProxy = () => {
    toast({
      title: "Skipped",
      description: "Proxy setup skipped. You can set up a proxy later.",
    });
    onContinue();
  };

  const handleShowProxySetup = () => {
    setShowProxySetup(true);
  };

  const handleProxyCreated = () => {
    setIsCreatingProxy(false);
    toast({
      title: "Success",
      description: "Proxy created successfully!",
    });
    onContinue();
  };

  const handleProxyError = (error: string) => {
    setIsCreatingProxy(false);
    toast({
      title: "Error",
      description: `Failed to create proxy: ${error}`,
      variant: "destructive",
    });
  };

  if (isCheckingProxies) {
    return (
      <CardUI
        title="Checking Proxy Status"
        description="Checking for existing proxy configurations..."
        cardClassName="col-span-2"
      >
        <div className="flex items-center justify-center py-8">
          <Loader className="h-8 w-8 animate-spin" />
          <span className="ml-2">Checking proxy status...</span>
        </div>
      </CardUI>
    );
  }

  if (showProxySetup) {
    return (
      <div className="space-y-6">
        <CardUI
          title="Create Proxy"
          description="Set up a proxy for your new wallet"
          cardClassName="col-span-2"
        >
          <ProxySetup
            walletId={newWalletId}
            onSuccess={handleProxyCreated}
            onError={handleProxyError}
            onCancel={() => setShowProxySetup(false)}
          />
        </CardUI>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CardUI
        title="Proxy Setup"
        description="Configure proxy settings for your new wallet"
        cardClassName="col-span-2"
      >
        <div className="space-y-4">
          {hasExistingProxy ? (
            <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20">
              <CheckCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertDescription className="text-blue-800 dark:text-blue-200">
                Your current wallet has an existing proxy configuration. 
                You can create a new proxy for the migrated wallet or skip this step.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20">
              <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                No existing proxy found. You can optionally create a proxy for your new wallet 
                to enable advanced features like delegation and governance participation.
              </AlertDescription>
            </Alert>
          )}

          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
            <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">What is a Proxy?</h4>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
              A proxy allows you to delegate certain operations to another address while maintaining 
              control over your funds. This is useful for:
            </p>
            <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-1 ml-4">
              <li>• Staking delegation</li>
              <li>• Governance participation (DRep voting)</li>
              <li>• Advanced transaction management</li>
            </ul>
          </div>

          {hasExistingProxy && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
              <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Existing Proxy</h4>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Your current wallet has {existingProxies?.length || 0} active proxy configuration(s).
                The proxy will need to be updated to point to your new wallet after migration.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4">
          <Button
            variant="outline"
            onClick={onBack}
            className="flex-1"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            variant="outline"
            onClick={handleSkipProxy}
            className="flex-1"
          >
            <SkipForward className="h-4 w-4 mr-2" />
            Skip Proxy
          </Button>
          <Button
            onClick={handleShowProxySetup}
            disabled={isCreatingProxy}
            className="flex-1"
          >
            {isCreatingProxy ? (
              <>
                <Loader className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Create Proxy
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </CardUI>
    </div>
  );
}
