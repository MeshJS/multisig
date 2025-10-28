import React, { useState, useCallback } from "react";
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
import ProxyTransferStep from "./migration/ProxyTransferStep";
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
    { id: 4, title: "Transfer Proxies", description: "Move proxy registrations" },
    { id: 5, title: "Complete", description: "Finish migration" },
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
      
      <div className="space-y-6">
        {/* Mobile Layout - Vertical Stack */}
        <div className="block md:hidden space-y-4">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center space-x-4">
              {/* Circle */}
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-all duration-300 flex-shrink-0 ${
                  index < currentStep
                    ? "bg-green-500 border-green-500 text-white shadow-lg"
                    : index === currentStep
                    ? "bg-primary border-primary text-primary-foreground shadow-lg animate-pulse"
                    : "bg-muted border-muted-foreground text-muted-foreground"
                }`}
              >
                {index < currentStep ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  index + 1
                )}
              </div>
              
              {/* Text Content */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  index <= currentStep ? "text-foreground" : "text-muted-foreground"
                }`}>
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {step.description}
                </p>
              </div>
              
              {/* Progress indicator for mobile */}
              {index < currentStep && (
                <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
              )}
            </div>
          ))}
        </div>

        {/* Desktop Layout - Horizontal with aligned circles and text */}
        <div className="hidden md:block">
          <div className="flex items-start justify-center w-full max-w-5xl mx-auto">
            {steps.map((step, index) => (
              <div key={step.id} className="flex flex-col items-center flex-1 relative">
                {/* Circle and Text Container */}
                <div className="flex flex-col items-center">
                  {/* Circle */}
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-all duration-300 mb-3 ${
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
                  
                  {/* Text Content */}
                  <div className="text-center px-2">
                    <p className={`text-sm font-medium ${
                      index <= currentStep ? "text-foreground" : "text-muted-foreground"
                    }`}>
                      {step.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 leading-tight">
                      {step.description}
                    </p>
                  </div>
                </div>
                
                {/* Connecting Line (except for last step) */}
                {index < steps.length - 1 && (
                  <div
                    className={`absolute top-6 left-1/2 w-full h-1 -translate-y-1/2 transition-all duration-300 ${
                      index < currentStep ? "bg-green-500" : "bg-muted"
                    }`}
                    style={{ 
                      width: `calc(100% - 3rem)`,
                      left: `calc(50% + 1.5rem)`
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// Migration step constants for better maintainability
const MIGRATION_STEPS = {
  PRE_CHECKS: 0,
  CREATE_WALLET: 1,
  PROXY_SETUP: 2,
  FUND_TRANSFER: 3,
  PROXY_TRANSFER: 4,
  COMPLETE: 5,
} as const;

type MigrationStep = typeof MIGRATION_STEPS[keyof typeof MIGRATION_STEPS];

interface MigrationState {
  step: MigrationStep | null;
  newWalletId: string | null;
  migrationId: string | null;
  isStarting: boolean;
  isAborting: boolean;
  hasAborted: boolean;
}

export function MigrateWallet({ appWallet }: { appWallet: Wallet }) {
  // Consolidated migration state
  const [migrationState, setMigrationState] = useState<MigrationState>({
    step: null,
    newWalletId: null,
    migrationId: null,
    isStarting: false,
    isAborting: false,
    hasAborted: false,
  });

  // API mutations
  const { mutateAsync: abortMigration } = api.wallet.abortMigration.useMutation();
  const { mutate: createMigration } = api.migration.createMigration.useMutation();
  const { mutate: updateMigrationStep } = api.migration.updateMigrationStep.useMutation();
  const { mutate: completeMigration } = api.migration.completeMigration.useMutation();
  const { mutateAsync: cancelMigration } = api.migration.cancelMigration.useMutation();
  const { mutateAsync: deleteNewWallet } = api.wallet.deleteNewWallet.useMutation();
  const utils = api.useUtils();
  const { userAddress } = useUserStore();

  // Helper functions for state management
  const updateMigrationState = useCallback((updates: Partial<MigrationState>) => {
    setMigrationState(prev => ({ ...prev, ...updates }));
  }, []);

  const resetMigrationState = useCallback(() => {
    setMigrationState({
      step: null,
      newWalletId: null,
      migrationId: null,
      isStarting: false,
      isAborting: false,
      hasAborted: false,
    });
  }, []);

  const resetMigrationStateWithAbortFlag = useCallback(() => {
    setMigrationState({
      step: null,
      newWalletId: null,
      migrationId: null,
      isStarting: false,
      isAborting: false,
      hasAborted: true,
    });
  }, []);

  // Check for existing pending migrations
  const { data: pendingMigrations } = api.migration.getPendingMigrations.useQuery(
    { ownerAddress: userAddress! },
    { enabled: !!userAddress }
  );

  // Check if current wallet has existing proxies
  const { data: existingProxies } = api.proxy.getProxiesByUserOrWallet.useQuery(
    { 
      walletId: appWallet.id,
      userAddress: userAddress!
    },
    { enabled: !!userAddress && !!appWallet.id }
  );


  // Auto-resume migration if there's an existing pending migration for this wallet
  React.useEffect(() => {
    if (pendingMigrations && pendingMigrations.length > 0) {
      const existingMigration = pendingMigrations.find(
        (migration: any) => migration.originalWalletId === appWallet.id
      );
      
      if (existingMigration && migrationState.step === null && !migrationState.hasAborted) {
        updateMigrationState({
          migrationId: existingMigration.id,
          step: existingMigration.currentStep as MigrationStep,
          newWalletId: existingMigration.newWalletId || null,
        });
      }
    }
  }, [pendingMigrations, appWallet.id, migrationState.step, migrationState.hasAborted, updateMigrationState]);

  // Auto-start migration if there's already a migration target (legacy support)
  React.useEffect(() => {
    const migrationTargetId = (appWallet as any).migrationTargetWalletId;
    
    if (migrationTargetId && migrationState.step === null && !migrationState.hasAborted && !migrationState.migrationId) {
      // Set the newWalletId but don't auto-start the migration steps
      // Let the user explicitly click "Continue Migration" to proceed
      updateMigrationState({ newWalletId: migrationTargetId });
    }
  }, [(appWallet as any).migrationTargetWalletId, migrationState.step, migrationState.hasAborted, migrationState.migrationId, updateMigrationState]);

  // Reset abort flag when migration target is cleared (after successful abort)
  React.useEffect(() => {
    if (migrationState.hasAborted && !(appWallet as any).migrationTargetWalletId) {
      updateMigrationState({ hasAborted: false });
    }
  }, [migrationState.hasAborted, (appWallet as any).migrationTargetWalletId, updateMigrationState]);

  const handleStartMigration = () => {
    // Reset any previous state before starting new migration
    resetMigrationState();
    updateMigrationState({ isStarting: true });
    
    // Create migration record
    createMigration({
      originalWalletId: appWallet.id,
      ownerAddress: userAddress!,
      migrationData: {
        walletName: appWallet.name,
        walletDescription: appWallet.description,
        startedAt: new Date().toISOString()
      }
    }, {
      onSuccess: (migration) => {
        // If there's already a migration target, start at step 1 (wallet creation)
        // Otherwise start at step 0 (pre-checks)
        const migrationTargetId = (appWallet as any).migrationTargetWalletId;
        const startStep = migrationTargetId ? MIGRATION_STEPS.CREATE_WALLET : MIGRATION_STEPS.PRE_CHECKS;
        
        updateMigrationState({
          migrationId: migration.id,
          step: startStep,
          newWalletId: migrationTargetId || null,
          isStarting: false,
          hasAborted: false,
        });

        updateMigrationStep({
          migrationId: migration.id,
          currentStep: startStep,
          status: "in_progress",
          newWalletId: migrationTargetId || undefined
        });
      },
      onError: (error) => {
        console.error("Failed to create migration:", error);
        updateMigrationState({ isStarting: false });
        toast({
          title: "Error",
          description: "Failed to start migration. Please try again.",
          variant: "destructive",
        });
      }
    });
  };

  const handlePreChecksContinue = () => {
    updateMigrationState({ step: MIGRATION_STEPS.CREATE_WALLET });
    if (migrationState.migrationId) {
      updateMigrationStep({
        migrationId: migrationState.migrationId,
        currentStep: MIGRATION_STEPS.CREATE_WALLET,
        status: "in_progress"
      });
    }
  };

  const handlePreChecksCancel = () => {
    resetMigrationState();
  };

  const handleNewWalletCreated = (createdWalletId: string) => {
    console.log("handleNewWalletCreated called with:", createdWalletId);
    console.log("Current migration state:", migrationState);
    console.log("App wallet migration target:", (appWallet as any).migrationTargetWalletId);
    
    // Check if wallet has existing proxies - if yes, skip to step 3 (fund transfer)
    // If no proxies, go to step 2 (proxy setup)
    const nextStep = existingProxies && existingProxies.length > 0 ? MIGRATION_STEPS.FUND_TRANSFER : MIGRATION_STEPS.PROXY_SETUP;
    
    updateMigrationState({ 
      newWalletId: createdWalletId,
      step: nextStep 
    });

    if (migrationState.migrationId) {
      updateMigrationStep({
        migrationId: migrationState.migrationId,
        currentStep: nextStep,
        status: "in_progress",
        newWalletId: createdWalletId
      });
    }
  };

  const handleNewWalletBack = () => {
    updateMigrationState({ step: MIGRATION_STEPS.PRE_CHECKS });
  };

  const handleProxySetupContinue = () => {
    updateMigrationState({ step: MIGRATION_STEPS.FUND_TRANSFER });
    if (migrationState.migrationId) {
      updateMigrationStep({
        migrationId: migrationState.migrationId,
        currentStep: MIGRATION_STEPS.FUND_TRANSFER,
        status: "in_progress"
      });
    }
  };

  const handleProxySetupSkip = () => {
    updateMigrationState({ step: MIGRATION_STEPS.FUND_TRANSFER });
    if (migrationState.migrationId) {
      updateMigrationStep({
        migrationId: migrationState.migrationId,
        currentStep: MIGRATION_STEPS.FUND_TRANSFER,
        status: "in_progress"
      });
    }
  };

  const handleProxySetupBack = () => {
    updateMigrationState({ step: MIGRATION_STEPS.CREATE_WALLET });
  };

  const handleFundTransferContinue = () => {
    updateMigrationState({ step: MIGRATION_STEPS.PROXY_TRANSFER });
    if (migrationState.migrationId) {
      updateMigrationStep({
        migrationId: migrationState.migrationId,
        currentStep: MIGRATION_STEPS.PROXY_TRANSFER,
        status: "in_progress"
      });
    }
  };

  const handleFundTransferBack = () => {
    updateMigrationState({ step: MIGRATION_STEPS.PROXY_SETUP });
  };

  const handleProxyTransferContinue = () => {
    updateMigrationState({ step: MIGRATION_STEPS.COMPLETE });
    if (migrationState.migrationId) {
      updateMigrationStep({
        migrationId: migrationState.migrationId,
        currentStep: MIGRATION_STEPS.COMPLETE,
        status: "in_progress"
      });
    }
  };

  const handleProxyTransferBack = () => {
    updateMigrationState({ step: MIGRATION_STEPS.FUND_TRANSFER });
  };

  const handleArchiveOldWallet = () => {
    // Complete migration
    if (migrationState.migrationId) {
      completeMigration({ migrationId: migrationState.migrationId });
    }
    
    // Reset migration state
    resetMigrationState();
    
    toast({
      title: "Migration Complete",
      description: "Your wallet migration has been completed successfully.",
    });
  };

  const handleCancelMigration = () => {
    resetMigrationState();
  };

  const handleAbortMigration = async () => {
    // Try multiple sources for the migration target ID
    const migrationTargetId = migrationState.newWalletId || (appWallet as any).migrationTargetWalletId;
    
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

    updateMigrationState({ isAborting: true });
    console.log("Starting migration abort process...");
    try {
      console.log("Aborting migration with:", {
        walletId: appWallet.id,
        newWalletId: finalMigrationTargetId,
        migrationState
      });
      
      // Delete the wallet (NewWallet or Wallet)
      await abortMigration({
        walletId: appWallet.id,
        newWalletId: finalMigrationTargetId || undefined,
      });

      // Delete the migration record
      if (migrationState.migrationId) {
        await cancelMigration({ migrationId: migrationState.migrationId });
      }

      // Also delete any NewWallet if it exists (in case the final wallet wasn't created yet)
      if (migrationState.newWalletId && migrationState.newWalletId !== finalMigrationTargetId) {
        try {
          await deleteNewWallet({ walletId: migrationState.newWalletId });
          console.log("Deleted NewWallet:", migrationState.newWalletId);
        } catch (error) {
          console.log("NewWallet deletion failed (may not exist):", error);
        }
      }

      // Invalidate all relevant queries to refresh the UI
      await Promise.all([
        utils.wallet.getWallet.invalidate({
          address: userAddress!,
          walletId: appWallet.id,
        }),
        utils.wallet.getUserWallets.invalidate({
          address: userAddress!,
        }),
        utils.migration.getPendingMigrations.invalidate({
          ownerAddress: userAddress!,
        }),
      ]);

      // Show success message
      toast({
        title: "Migration Aborted",
        description: "The migration has been cancelled and all related data has been cleaned up.",
      });

      console.log("Migration abort completed successfully");
      
      // Small delay to ensure UI updates are processed
      setTimeout(() => {
        // Reset migration state with abort flag to show success UI
        resetMigrationStateWithAbortFlag();
        console.log("Migration state reset with abort flag");
      }, 100);
    } catch (error) {
      console.error("Failed to abort migration:", error);
      toast({
        title: "Error",
        description: "Failed to abort migration. Please try again.",
        variant: "destructive",
      });
    } finally {
      updateMigrationState({ isAborting: false });
    }
  };

  // Show migration steps
  if (migrationState.step !== null) {
    return (
      <div className="space-y-6">
        {/* Progress Indicator */}
        <CardUI
          title="Wallet Migration"
          description="Migrating your wallet to a new configuration"
          cardClassName="col-span-2"
        >
          <MigrationProgress 
            currentStep={migrationState.step} 
            totalSteps={5} 
            onAbortMigration={handleAbortMigration}
            isAbortingMigration={migrationState.isAborting}
          />
        </CardUI>

        {/* Connecting Line */}
        <div className="flex justify-center">
          <div className="w-px h-8 bg-gradient-to-b from-primary/30 to-transparent"></div>
        </div>

        {/* Step Content */}
        <div className="relative">
          {migrationState.step === MIGRATION_STEPS.PRE_CHECKS && (
            <MigrationPreChecks
              appWallet={appWallet}
              onContinue={handlePreChecksContinue}
              onCancel={handlePreChecksCancel}
            />
          )}

          {migrationState.step === MIGRATION_STEPS.CREATE_WALLET && (
            <NewWalletCreationStep
              appWallet={appWallet}
              onBack={handleNewWalletBack}
              onContinue={handleNewWalletCreated}
            />
          )}

          {migrationState.step === MIGRATION_STEPS.PROXY_SETUP && (!existingProxies || existingProxies.length === 0) && (
            <ProxySetupStep
              appWallet={appWallet}
              newWalletId={migrationState.newWalletId!}
              onBack={handleProxySetupBack}
              onContinue={handleProxySetupContinue}
            />
          )}

          {/* Show message if wallet already has proxies */}
          {migrationState.step === MIGRATION_STEPS.PROXY_SETUP && existingProxies && existingProxies.length > 0 && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <CheckCircle className="h-6 w-6 text-green-600" />
                </div>
                <h3 className="mt-2 text-sm font-medium text-gray-900">Proxies Already Configured</h3>
                <p className="mt-1 text-sm text-gray-500">
                  This wallet already has {existingProxies.length} proxy{existingProxies.length !== 1 ? 'ies' : ''} configured. 
                  You can proceed directly to fund transfer.
                </p>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleProxySetupSkip} className="bg-blue-600 hover:bg-blue-700">
                  Continue to Fund Transfer
                </Button>
              </div>
            </div>
          )}

          {migrationState.step === MIGRATION_STEPS.FUND_TRANSFER && (
            <FundTransferStep
              appWallet={appWallet}
              newWalletId={(appWallet as any).migrationTargetWalletId || migrationState.newWalletId!}
              onBack={handleFundTransferBack}
              onContinue={handleFundTransferContinue}
            />
          )}

          {migrationState.step === MIGRATION_STEPS.PROXY_TRANSFER && (
            <ProxyTransferStep
              appWallet={appWallet}
              newWalletId={(appWallet as any).migrationTargetWalletId || migrationState.newWalletId!}
              onBack={handleProxyTransferBack}
              onContinue={handleProxyTransferContinue}
            />
          )}

          {migrationState.step === MIGRATION_STEPS.COMPLETE && (
            <MigrationCompleteStep
              appWallet={appWallet}
              newWalletId={(appWallet as any).migrationTargetWalletId || migrationState.newWalletId!}
              onBack={handleArchiveOldWallet}
            />
          )}
        </div>
      </div>
    );
  }

  // Show abort success state
  if (migrationState.hasAborted) {
    console.log("Rendering abort success state with migration state:", migrationState);
    return (
      <CardUI
        title="Migration Aborted"
        description="The migration has been successfully cancelled and all related data has been cleaned up."
        cardClassName="col-span-2"
      >
        <div className="space-y-4">
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Migration successfully aborted. All wallets, migration records, and references have been removed. You can start a new migration when ready.
            </AlertDescription>
          </Alert>
          
          <div className="flex gap-3">
            <Button
              onClick={handleStartMigration}
              className="flex-1"
              size="lg"
            >
              <ArrowRight className="h-4 w-4 mr-2" />
              Start New Migration
            </Button>
          </div>
        </div>
      </CardUI>
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
        {(appWallet as any).migrationTargetWalletId || migrationState.newWalletId ? (
          <Alert className="border-blue-200 bg-blue-50">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              <strong>Migration In Progress:</strong> You have an ongoing migration. Click "Continue Migration" to resume where you left off.
              <br />
              <small className="text-blue-600">
                Debug: Migration Target ID: {(appWallet as any).migrationTargetWalletId || migrationState.newWalletId}
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
          {((appWallet as any).migrationTargetWalletId || migrationState.newWalletId || migrationState.step !== null) && (
            <Button
              variant="destructive"
              onClick={handleAbortMigration}
              disabled={migrationState.isAborting}
            >
              {migrationState.isAborting ? (
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
            disabled={migrationState.isStarting}
            className="flex-1"
          >
            {migrationState.isStarting ? (
              <>
                <Loader className="h-4 w-4 animate-spin mr-2" />
                {(appWallet as any).migrationTargetWalletId || migrationState.newWalletId ? "Resuming Migration..." : "Starting Migration..."}
              </>
            ) : (
              <>
                {(appWallet as any).migrationTargetWalletId || migrationState.newWalletId ? "Continue Migration" : "Start Migration"}
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </CardUI>
  );
}
