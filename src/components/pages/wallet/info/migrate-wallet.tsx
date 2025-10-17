import React, { useState } from "react";
import CardUI from "@/components/ui/card-content";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowRight, AlertCircle, Loader, CheckCircle, X } from "lucide-react";
import { Wallet } from "@/types/wallet";
import { toast } from "@/hooks/use-toast";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import MigrationPreChecks from "./migration/MigrationPreChecks";
import NewWalletCreationStep from "./migration/NewWalletCreationStep";
import ProxySetupStep from "./migration/ProxySetupStep";
import FundTransferStep from "./migration/FundTransferStep";
import MigrationCompleteStep from "./migration/MigrationCompleteStep";

// Progress indicator component
const MigrationProgress = ({ 
  currentStep, 
  totalSteps, 
  onAbortMigration, 
  isAbortingMigration 
}: { 
  currentStep: number; 
  totalSteps: number;
  onAbortMigration: () => void;
  isAbortingMigration: boolean;
}) => {
  const steps = [
    { id: 0, title: "Pre-checks", description: "Verify wallet status" },
    { id: 1, title: "Create Wallet", description: "Configure new wallet" },
    { id: 2, title: "Proxy Setup", description: "Setup proxy (optional)" },
    { id: 3, title: "Transfer Funds", description: "Move all assets" },
    { id: 4, title: "Complete", description: "Finish migration" },
  ];

  return (
    <div className="mb-8 p-6 bg-gradient-to-r from-primary/5 to-primary/10 rounded-lg border border-primary/20">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">Migration Progress</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground bg-background px-3 py-1 rounded-full border">
            Step {currentStep + 1} of {totalSteps}
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={onAbortMigration}
            disabled={isAbortingMigration}
          >
            {isAbortingMigration ? (
              <>
                <Loader className="h-4 w-4 animate-spin mr-2" />
                Aborting...
              </>
            ) : (
              <>
                <X className="h-4 w-4 mr-2" />
                Abort Migration
              </>
            )}
          </Button>
        </div>
      </div>
      
      <div className="space-y-4">
        {/* Circles Row with Connecting Lines */}
        <div className="flex items-center justify-center w-full max-w-4xl mx-auto">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              {/* Circle */}
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-all duration-300 ${
                  index < currentStep
                    ? "bg-green-500 border-green-500 text-white shadow-lg"
                    : index === currentStep
                    ? "bg-primary border-primary text-primary-foreground shadow-lg animate-pulse"
                    : "bg-muted border-muted-foreground text-muted-foreground"
                }`}
              >
                {index < currentStep ? (
                  <CheckCircle className="h-6 w-6" />
                ) : (
                  index + 1
                )}
              </div>
              
              {/* Connecting Line (except for last step) */}
              {index < steps.length - 1 && (
                <div
                  className={`w-16 h-1 mx-4 rounded-full transition-all duration-300 ${
                    index < currentStep ? "bg-green-500" : "bg-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Text Row */}
        <div className="flex items-start justify-between w-full max-w-4xl mx-auto">
          {steps.map((step, index) => (
            <div key={step.id} className="flex flex-col items-center flex-1">
              <div className="text-center max-w-24">
                <p className={`text-xs font-medium ${
                  index <= currentStep ? "text-foreground" : "text-muted-foreground"
                }`}>
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export function MigrateWallet({ appWallet }: { appWallet: Wallet }) {
  // Migration step state: 0 = pre-checks, 1 = create wallet, 2 = proxy setup, 3 = fund transfer, 4 = complete
  const [migrationStep, setMigrationStep] = useState<number | null>(null);
  const [newWalletId, setNewWalletId] = useState<string | null>(null);
  const [isStartingMigration, setIsStartingMigration] = useState(false);
  const [isAbortingMigration, setIsAbortingMigration] = useState(false);
  const [hasAbortedMigration, setHasAbortedMigration] = useState(false);

  // API mutations
  const { mutateAsync: abortMigration } = api.wallet.abortMigration.useMutation();
  const utils = api.useUtils();
  const { userAddress } = useUserStore();


  // Auto-start migration if there's already a migration target
  React.useEffect(() => {
    const migrationTargetId = (appWallet as any).migrationTargetWalletId;
    
    if (migrationTargetId && migrationStep === null && !hasAbortedMigration) {
      // Set the newWalletId but don't auto-start the migration steps
      // Let the user explicitly click "Continue Migration" to proceed
      setNewWalletId(migrationTargetId);
    }
  }, [(appWallet as any).migrationTargetWalletId, migrationStep, hasAbortedMigration]);

  // Reset abort flag when migration target is cleared (after successful abort)
  React.useEffect(() => {
    if (hasAbortedMigration && !(appWallet as any).migrationTargetWalletId) {
      setHasAbortedMigration(false);
    }
  }, [hasAbortedMigration, (appWallet as any).migrationTargetWalletId]);

  const handleStartMigration = () => {
    setIsStartingMigration(true);
    // If there's already a migration target, start at step 1 (wallet creation)
    // Otherwise start at step 0 (pre-checks)
    const migrationTargetId = (appWallet as any).migrationTargetWalletId;
    if (migrationTargetId) {
      setMigrationStep(1);
      setNewWalletId(migrationTargetId);
    } else {
      setMigrationStep(0);
    }
  };

  const handlePreChecksContinue = () => {
    setMigrationStep(1);
  };

  const handlePreChecksCancel = () => {
    setMigrationStep(null);
    setIsStartingMigration(false);
  };

  const handleNewWalletCreated = (createdWalletId: string) => {
    setNewWalletId(createdWalletId);
    setMigrationStep(2);
  };

  const handleNewWalletBack = () => {
    setMigrationStep(0);
  };

  const handleProxySetupContinue = () => {
    setMigrationStep(3);
  };

  const handleProxySetupSkip = () => {
    setMigrationStep(3);
  };

  const handleProxySetupBack = () => {
    setMigrationStep(1);
  };

  const handleFundTransferContinue = () => {
    setMigrationStep(4);
  };

  const handleFundTransferBack = () => {
    setMigrationStep(2);
  };

  const handleArchiveOldWallet = () => {
    // Reset migration state
    setMigrationStep(null);
    setNewWalletId(null);
    setIsStartingMigration(false);
    
    toast({
      title: "Migration Complete",
      description: "Your wallet migration has been completed successfully.",
    });
  };

  const handleCancelMigration = () => {
    setMigrationStep(null);
    setNewWalletId(null);
    setIsStartingMigration(false);
  };

  const handleAbortMigration = async () => {
    // Try multiple sources for the migration target ID
    const migrationTargetId = newWalletId || (appWallet as any).migrationTargetWalletId;
    
    // If we still don't have it, try to fetch the wallet data directly
    let finalMigrationTargetId = migrationTargetId;
    if (!finalMigrationTargetId && userAddress) {
      try {
        const freshWalletData = await utils.wallet.getWallet.fetch({
          address: userAddress,
          walletId: appWallet.id,
        });
        finalMigrationTargetId = (freshWalletData as any).migrationTargetWalletId;
      } catch (error) {
        console.error("Failed to fetch fresh wallet data:", error);
      }
    }
    
    if (!finalMigrationTargetId) {
      toast({
        title: "Error",
        description: "No migration to abort. No migration target wallet found.",
        variant: "destructive",
      });
      return;
    }

    setIsAbortingMigration(true);
    try {
      await abortMigration({
        walletId: appWallet.id,
        newWalletId: finalMigrationTargetId,
      });

      // Reset migration state
      setMigrationStep(null);
      setNewWalletId(null);
      setIsStartingMigration(false);
      setHasAbortedMigration(true);

      // Invalidate wallet queries to refresh the UI
      await Promise.all([
        utils.wallet.getWallet.invalidate({
          address: userAddress!,
          walletId: appWallet.id,
        }),
        utils.wallet.getUserWallets.invalidate({
          address: userAddress!,
        }),
      ]);

      toast({
        title: "Migration Aborted",
        description: "The migration has been cancelled and the new wallet has been removed.",
      });
    } catch (error) {
      console.error("Failed to abort migration:", error);
      toast({
        title: "Error",
        description: "Failed to abort migration. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsAbortingMigration(false);
    }
  };

  // Show migration steps
  if (migrationStep !== null) {
    return (
      <div className="space-y-6">
        {/* Progress Indicator */}
        <CardUI
          title="Wallet Migration"
          description="Migrating your wallet to a new configuration"
          cardClassName="col-span-2"
        >
          <MigrationProgress 
            currentStep={migrationStep} 
            totalSteps={5} 
            onAbortMigration={handleAbortMigration}
            isAbortingMigration={isAbortingMigration}
          />
        </CardUI>

        {/* Connecting Line */}
        <div className="flex justify-center">
          <div className="w-px h-8 bg-gradient-to-b from-primary/30 to-transparent"></div>
        </div>

        {/* Step Content */}
        <div className="relative">
          {migrationStep === 0 && (
            <MigrationPreChecks
              appWallet={appWallet}
              onContinue={handlePreChecksContinue}
              onCancel={handlePreChecksCancel}
            />
          )}

          {migrationStep === 1 && (
            <NewWalletCreationStep
              appWallet={appWallet}
              onBack={handleNewWalletBack}
              onContinue={handleNewWalletCreated}
            />
          )}

          {migrationStep === 2 && (
            <ProxySetupStep
              appWallet={appWallet}
              newWalletId={newWalletId!}
              onBack={handleProxySetupBack}
              onContinue={handleProxySetupContinue}
              onSkip={handleProxySetupSkip}
            />
          )}

          {migrationStep === 3 && (
            <FundTransferStep
              appWallet={appWallet}
              newWalletId={newWalletId!}
              onBack={handleFundTransferBack}
              onContinue={handleFundTransferContinue}
            />
          )}

          {migrationStep === 4 && (
            <MigrationCompleteStep
              appWallet={appWallet}
              newWalletId={newWalletId!}
              onArchiveOldWallet={handleArchiveOldWallet}
            />
          )}
        </div>
      </div>
    );
  }

  // Show initial migration card
  return (
    <CardUI
      title="Migrate Wallet"
      description={(appWallet as any).migrationTargetWalletId ? "Continue your wallet migration" : "Adjust the signers and move all funds to a new wallet"}
      cardClassName="col-span-2"
    >
      <div className="space-y-4">
        {(appWallet as any).migrationTargetWalletId ? (
          <Alert className="border-blue-200 bg-blue-50">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              <strong>Migration In Progress:</strong> You have an ongoing migration. Click "Continue Migration" to resume where you left off.
              <br />
              <small className="text-blue-600">
                Debug: Migration Target ID: {(appWallet as any).migrationTargetWalletId}
              </small>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Migration Process:</strong> This will create a new wallet with updated signers and transfer all funds from your current wallet. 
              The process includes pre-checks, wallet creation, proxy setup, and fund transfer.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 border rounded-lg">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
              1
            </div>
            <span className="text-sm">Pre-checks (DRep, staking, pending transactions)</span>
          </div>
          
          <div className="flex items-center gap-3 p-3 border rounded-lg">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
              2
            </div>
            <span className="text-sm">Create new wallet with updated configuration</span>
          </div>
          
          <div className="flex items-center gap-3 p-3 border rounded-lg">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
              3
            </div>
            <span className="text-sm">Setup proxy for the new wallet (optional)</span>
          </div>
          
          <div className="flex items-center gap-3 p-3 border rounded-lg">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
              4
            </div>
            <span className="text-sm">Transfer all funds to the new wallet</span>
          </div>
          
          <div className="flex items-center gap-3 p-3 border rounded-lg">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
              5
            </div>
            <span className="text-sm">Complete migration and archive old wallet</span>
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          {((appWallet as any).migrationTargetWalletId || newWalletId || migrationStep !== null) && (
            <Button
              variant="destructive"
              onClick={handleAbortMigration}
              disabled={isAbortingMigration}
            >
              {isAbortingMigration ? (
                <>
                  <Loader className="h-4 w-4 animate-spin mr-2" />
                  Aborting...
                </>
              ) : (
                <>
                  <X className="h-4 w-4 mr-2" />
                  Abort Migration
                </>
              )}
            </Button>
          )}
          <Button
            onClick={handleStartMigration}
            disabled={isStartingMigration}
            className="flex-1"
          >
            {isStartingMigration ? (
              <>
                <Loader className="h-4 w-4 animate-spin mr-2" />
                {(appWallet as any).migrationTargetWalletId ? "Resuming Migration..." : "Starting Migration..."}
              </>
            ) : (
              <>
                {(appWallet as any).migrationTargetWalletId ? "Continue Migration" : "Start Migration"}
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </CardUI>
  );
}
