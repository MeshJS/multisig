import React, { useState, useCallback } from "react";
import CardUI from "@/components/ui/card-content";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowRight, AlertCircle, Loader, CheckCircle, X, Info } from "lucide-react";
import { Wallet } from "@/types/wallet";
import { toast } from "@/hooks/use-toast";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import MigrationPreChecks from "./migration/MigrationPreChecks";
import NewWalletCreationStep from "./migration/NewWalletCreationStep";
import ProxySetupStep from "./migration/ProxySetupStep";
import FundTransferStep from "./migration/FundTransferStep";
import ProxyTransferStep from "./migration/ProxyTransferStep";
import MigrationCompleteStep from "./migration/MigrationCompleteStep";

// Progress indicator component - simplified
const MigrationProgress = ({ 
  currentStep, 
  totalSteps
}: { 
  currentStep: number; 
  totalSteps: number;
}) => {
  const steps = [
    { id: 0, title: "Pre-checks", shortTitle: "Pre-checks" },
    { id: 1, title: "Create Wallet", shortTitle: "Create" },
    { id: 2, title: "Proxy Setup", shortTitle: "Proxy" },
    { id: 3, title: "Transfer Funds", shortTitle: "Transfer" },
    { id: 4, title: "Transfer Proxies", shortTitle: "Proxies" },
    { id: 5, title: "Complete", shortTitle: "Complete" },
  ];

  const getStepStatus = (stepIndex: number) => {
    if (stepIndex < currentStep) return "completed";
    if (stepIndex === currentStep) return "active";
    return "pending";
  };

  // Calculate progress percentage, capped at 100%
  // currentStep is 0-indexed (0-5), so we add 1 to get the step number
  // Cap at 100% to prevent showing more than 100%
  const progressPercentage = Math.min(100, ((currentStep + 1) / totalSteps) * 100);

  return (
    <div className="mb-6 p-6 bg-gradient-to-r from-primary/5 to-primary/10 rounded-lg border border-primary/10 dark:from-primary/10 dark:to-primary/5">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Migration Progress</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current step:</span>
            <span className="font-medium">{steps[currentStep]?.title || "Starting..."}</span>
          </div>
          {/* Progress bar */}
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progressPercentage}%` }}
              role="progressbar"
              aria-valuenow={currentStep + 1}
              aria-valuemin={1}
              aria-valuemax={totalSteps}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Step {currentStep + 1} of {totalSteps}</span>
            <span>{Math.round(progressPercentage)}%</span>
          </div>
        </div>
      </div>
      
      {/* Simplified step indicators */}
      <div className="flex items-center justify-between gap-2">
        {steps.map((step, index) => {
          const status = getStepStatus(index);
          return (
            <div key={step.id} className="flex flex-col items-center flex-1 relative">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 transition-all duration-300 ${
                  status === "completed"
                    ? "bg-green-500 border-green-500 text-white"
                    : status === "active"
                    ? "bg-primary border-primary text-primary-foreground ring-2 ring-primary/20"
                    : "bg-muted border-muted-foreground text-muted-foreground"
                }`}
                aria-label={`Step ${index + 1}: ${step.title} - ${status === "completed" ? "Completed" : status === "active" ? "In Progress" : "Pending"}`}
              >
                {status === "completed" ? (
                  <CheckCircle className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <span aria-hidden="true">{index + 1}</span>
                )}
              </div>
              <p className={`text-xs mt-2 text-center hidden sm:block ${
                status !== "pending" ? "text-foreground font-medium" : "text-muted-foreground"
              }`}>
                {step.shortTitle}
              </p>
              {index < steps.length - 1 && (
                <div
                  className={`absolute top-4 left-1/2 w-full h-0.5 transition-all duration-300 ${
                    status === "completed" ? "bg-green-500" : "bg-muted"
                  }`}
                  style={{ 
                    width: `calc(100% - 2rem)`,
                    left: `calc(50% + 1rem)`
                  }}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
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
  showAbortConfirm: boolean;
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
    showAbortConfirm: false,
  });

  // API mutations
  const { mutateAsync: abortMigration } = api.wallet.abortMigration.useMutation();
  const { mutate: createMigration } = api.migration.createMigration.useMutation();
  const { mutateAsync: updateMigrationStep } = api.migration.updateMigrationStep.useMutation();
  const { mutate: completeMigration } = api.migration.completeMigration.useMutation();
  const { mutateAsync: cancelMigration } = api.migration.cancelMigration.useMutation();
  const { mutateAsync: deleteNewWallet } = api.wallet.deleteNewWallet.useMutation();
  const { mutateAsync: createNewWallet } = api.wallet.createNewWallet.useMutation();
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
      showAbortConfirm: false,
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
      showAbortConfirm: false,
    });
  }, []);

  // Check for existing pending migrations for current user
  const { data: pendingMigrations } = api.migration.getPendingMigrations.useQuery(
    { ownerAddress: userAddress! },
    { enabled: !!userAddress }
  );

  // Check for ANY pending migration for this wallet (regardless of owner)
  const { data: walletPendingMigration } = api.migration.getMigrationByOriginalWallet.useQuery(
    { originalWalletId: appWallet.id },
    { enabled: !!appWallet.id }
  );

  // Check if current wallet has existing proxies
  const { data: existingProxies } = api.proxy.getProxiesByUserOrWallet.useQuery(
    { 
      walletId: appWallet.id,
      userAddress: userAddress!
    },
    { enabled: !!userAddress && !!appWallet.id }
  );

  // Check for pending fund transfer transaction
  const { transactions: pendingTransactions } = usePendingTransactions({ walletId: appWallet.id });
  const hasPendingFundTransfer = React.useMemo(() => {
    if (!pendingTransactions || pendingTransactions.length === 0) return false;
    return pendingTransactions.some((tx: any) => 
      tx.description?.includes("Migration: Transfer all funds") && 
      !tx.txHash && 
      tx.state !== 1
    );
  }, [pendingTransactions]);


  // Don't auto-resume - let user explicitly choose to continue
  // This allows them to cancel pending migrations easily

  // Auto-start migration if there's already a migration target (legacy support)
  React.useEffect(() => {
    const migrationTargetId = (appWallet as any).migrationTargetWalletId;
    
    if (migrationTargetId && migrationState.step === null && !migrationState.hasAborted && !migrationState.migrationId) {
      // Set the newWalletId but don't auto-start the migration steps
      // Let the user explicitly click "Continue Migration" to proceed
      updateMigrationState({ newWalletId: migrationTargetId });
    }
  }, [(appWallet as any).migrationTargetWalletId, migrationState.step, migrationState.hasAborted, migrationState.migrationId, updateMigrationState]);

  // Reset abort flag when migration target is cleared and no pending migrations exist (after successful abort)
  React.useEffect(() => {
    const hasNoPendingMigration = !walletPendingMigration && (!pendingMigrations || pendingMigrations.length === 0);
    const hasNoMigrationTarget = !(appWallet as any).migrationTargetWalletId;
    
    if (migrationState.hasAborted && hasNoMigrationTarget && hasNoPendingMigration) {
      updateMigrationState({ hasAborted: false });
    }
  }, [migrationState.hasAborted, (appWallet as any).migrationTargetWalletId, walletPendingMigration, pendingMigrations, updateMigrationState]);

  const handleStartMigration = async () => {
    // Check if there's an existing pending migration
    const existingMigration = pendingMigrations?.find(
      (migration: any) => migration.originalWalletId === appWallet.id
    );

    if (existingMigration) {
      // Check if this migration belongs to the current user
      if (existingMigration.ownerAddress === userAddress) {
        // Check database for newWalletId - if null, create a new wallet
        let migrationTargetId = existingMigration.newWalletId || (appWallet as any).migrationTargetWalletId;
        
        // If newWalletId is null in database, create a temporary wallet
        if (!existingMigration.newWalletId && !migrationTargetId) {
          try {
            // Get current wallet data to use for migration
            const currentWalletData = await utils.wallet.getWallet.fetch({
              address: userAddress!,
              walletId: appWallet.id,
            });
            
            if (currentWalletData) {
              // Create temporary NewWallet for migration
              const newWallet = await createNewWallet({
                name: `${currentWalletData.name} - Migration in Progress`,
                description: currentWalletData.description ?? "",
                signersAddresses: currentWalletData.signersAddresses ?? [],
                signersDescriptions: currentWalletData.signersDescriptions ?? [],
                signersStakeKeys: currentWalletData.signersStakeKeys ?? [],
                signersDRepKeys: (currentWalletData as any).signersDRepKeys ?? [],
                numRequiredSigners: currentWalletData.numRequiredSigners ?? 1,
                ownerAddress: userAddress!,
                stakeCredentialHash: currentWalletData.stakeCredentialHash ?? null,
                scriptType: (currentWalletData.type as string) ?? "atLeast",
              });
              
              migrationTargetId = newWallet.id;
              
              // Save the new wallet ID to the migration record
              await updateMigrationStep({
                migrationId: existingMigration.id,
                currentStep: existingMigration.currentStep,
                status: "in_progress",
                newWalletId: newWallet.id,
              });
            }
          } catch (error) {
            console.error("Failed to create temporary wallet for migration:", error);
            toast({
              title: "Error",
              description: "Failed to create temporary wallet. Please try again.",
              variant: "destructive",
            });
            updateMigrationState({ isStarting: false });
            return;
          }
        }
        
        // Check if the wallet already exists (either as Wallet or NewWallet)
        let walletExists = false;
        let isFinalWallet = false;
        
        if (migrationTargetId && userAddress) {
          try {
            // Try to fetch as Wallet first
            const walletData = await utils.wallet.getWallet.fetch({
              address: userAddress,
              walletId: migrationTargetId,
            });
            if (walletData) {
              walletExists = true;
              isFinalWallet = true;
            }
          } catch (error) {
            // Wallet doesn't exist, try NewWallet
            try {
              const newWalletData = await utils.wallet.getNewWallet.fetch({
                walletId: migrationTargetId,
              });
              if (newWalletData) {
                walletExists = true;
                isFinalWallet = false;
              }
            } catch (newWalletError) {
              // Neither exists - this shouldn't happen if we just created it
              console.warn("Wallet not found after creation:", migrationTargetId);
            }
          }
        }

        // Determine the correct step based on wallet existence
        let resumeStep = existingMigration.currentStep as MigrationStep;
        
        if (walletExists && isFinalWallet) {
          // Final wallet exists, skip to fund transfer
          resumeStep = MIGRATION_STEPS.FUND_TRANSFER;
        } else if (walletExists && !isFinalWallet) {
          // Temporary wallet exists, go to wallet creation to load it
          resumeStep = MIGRATION_STEPS.CREATE_WALLET;
        } else if (existingMigration.currentStep === MIGRATION_STEPS.PRE_CHECKS) {
          // Still at pre-checks, keep it
          resumeStep = MIGRATION_STEPS.PRE_CHECKS;
        } else {
          // Use the stored step
          resumeStep = existingMigration.currentStep as MigrationStep;
        }
        
        updateMigrationState({
          migrationId: existingMigration.id,
          step: resumeStep,
          newWalletId: migrationTargetId || null,
          isStarting: false,
          hasAborted: false,
        });
      } else {
        // Migration exists but owned by different signer
        toast({
          title: "Migration In Progress",
          description: `A migration is already in progress for this wallet, started by another signer. Please wait for it to complete or ask them to cancel it.`,
          variant: "destructive",
        });
        return;
      }
    } else {
      // Start new migration - backend will check for conflicts
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
          const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
          updateMigrationState({ isStarting: false });
          
          // Check if it's a conflict error (migration already exists)
          if (errorMessage.includes("already in progress") || errorMessage.includes("CONFLICT")) {
            toast({
              title: "Migration Already In Progress",
              description: errorMessage,
              variant: "destructive",
            });
          } else {
            toast({
              title: "Error",
              description: `Failed to start migration: ${errorMessage}. Please try again.`,
              variant: "destructive",
            });
          }
        }
      });
    }
  };

  const handlePreChecksContinue = async () => {
    // Check if there's already a temporary wallet or migration target
    const existingWalletId = migrationState.newWalletId || (appWallet as any).migrationTargetWalletId;
    
    updateMigrationState({ step: MIGRATION_STEPS.CREATE_WALLET });
    if (migrationState.migrationId) {
      // Update migration with newWalletId if it exists
      await updateMigrationStep({
        migrationId: migrationState.migrationId,
        currentStep: MIGRATION_STEPS.CREATE_WALLET,
        status: "in_progress",
        newWalletId: existingWalletId || undefined
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
    
    // Determine next step:
    // - If fund transfer is already pending, skip to proxy transfer
    // - If wallet has existing proxies, skip proxy setup and go to fund transfer
    // - Otherwise, go to proxy setup
    let nextStep: MigrationStep;
    if (hasPendingFundTransfer) {
      nextStep = MIGRATION_STEPS.PROXY_TRANSFER;
    } else if (existingProxies && existingProxies.length > 0) {
      nextStep = MIGRATION_STEPS.FUND_TRANSFER;
    } else {
      nextStep = MIGRATION_STEPS.PROXY_SETUP;
    }
    
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
    // Skip fund transfer if transaction is already pending
    const nextStep = hasPendingFundTransfer ? MIGRATION_STEPS.PROXY_TRANSFER : MIGRATION_STEPS.FUND_TRANSFER;
    updateMigrationState({ step: nextStep });
    if (migrationState.migrationId) {
      updateMigrationStep({
        migrationId: migrationState.migrationId,
        currentStep: nextStep,
        status: "in_progress"
      });
    }
  };

  const handleProxySetupSkip = () => {
    // Skip fund transfer if transaction is already pending
    const nextStep = hasPendingFundTransfer ? MIGRATION_STEPS.PROXY_TRANSFER : MIGRATION_STEPS.FUND_TRANSFER;
    updateMigrationState({ step: nextStep });
    if (migrationState.migrationId) {
      updateMigrationStep({
        migrationId: migrationState.migrationId,
        currentStep: nextStep,
        status: "in_progress"
      });
    }
  };

  const handleProxySetupBack = () => {
    updateMigrationState({ step: MIGRATION_STEPS.CREATE_WALLET });
  };

  const handleFundTransferContinue = useCallback(() => {
    updateMigrationState({ step: MIGRATION_STEPS.PROXY_TRANSFER });
    if (migrationState.migrationId) {
      updateMigrationStep({
        migrationId: migrationState.migrationId,
        currentStep: MIGRATION_STEPS.PROXY_TRANSFER,
        status: "in_progress"
      });
    }
  }, [migrationState.migrationId, updateMigrationState, updateMigrationStep]);

  // Auto-skip fund transfer step if transaction is already pending
  React.useEffect(() => {
    if (migrationState.step === MIGRATION_STEPS.FUND_TRANSFER && hasPendingFundTransfer) {
      handleFundTransferContinue();
    }
  }, [migrationState.step, hasPendingFundTransfer, handleFundTransferContinue]);

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

  const handleAbortMigrationClick = () => {
    updateMigrationState({ showAbortConfirm: true });
  };

  const handleAbortMigrationConfirm = async () => {
    updateMigrationState({ showAbortConfirm: false });

    updateMigrationState({ isAborting: true });
    try {
      // Find pending migration for this wallet if we don't have migrationId
      let migrationIdToCancel = migrationState.migrationId;
      if (!migrationIdToCancel && pendingMigrations) {
        const existingMigration = pendingMigrations.find(
          (migration: any) => migration.originalWalletId === appWallet.id
        );
        migrationIdToCancel = existingMigration?.id ?? null;
      }

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
          // Continue even if fetch fails
        }
      }
      
      // Delete the wallet (NewWallet or Wallet) if it exists
      if (finalMigrationTargetId) {
        try {
          await abortMigration({
            walletId: appWallet.id,
            newWalletId: finalMigrationTargetId,
          });
        } catch (error) {
          // Continue even if wallet deletion fails
        }
      }

      // Get migration record to check for newWalletId
      let migrationNewWalletId: string | null = null;
      if (migrationIdToCancel) {
        try {
          const migrationRecord = await utils.migration.getMigration.fetch({
            migrationId: migrationIdToCancel,
          });
          migrationNewWalletId = migrationRecord?.newWalletId || null;
        } catch (error) {
          // Migration fetch failed - continue anyway
        }
        
        // Cancel the migration record
        await cancelMigration({ migrationId: migrationIdToCancel });
      }

      // Collect all possible new wallet IDs to delete
      const walletIdsToDelete = new Set<string>();
      if (finalMigrationTargetId) walletIdsToDelete.add(finalMigrationTargetId);
      if (migrationState.newWalletId) walletIdsToDelete.add(migrationState.newWalletId);
      if (migrationNewWalletId) walletIdsToDelete.add(migrationNewWalletId);

      // Delete all NewWallet records (try each ID as it might be a temporary wallet)
      for (const walletId of walletIdsToDelete) {
        try {
          // First try to delete as NewWallet
          await deleteNewWallet({ walletId });
        } catch (error) {
          // NewWallet deletion failed (may not exist or may be a final Wallet) - continue
        }
      }

      // Invalidate and refetch all relevant queries to refresh the UI
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
        utils.migration.getMigrationByOriginalWallet.invalidate({
          originalWalletId: appWallet.id,
        }),
      ]);

      // Refetch queries immediately to get fresh data
      await Promise.all([
        utils.wallet.getWallet.refetch({
          address: userAddress!,
          walletId: appWallet.id,
        }),
        utils.migration.getPendingMigrations.refetch({
          ownerAddress: userAddress!,
        }),
        utils.migration.getMigrationByOriginalWallet.refetch({
          originalWalletId: appWallet.id,
        }),
      ]);

      // Show success message
      toast({
        title: "Migration Aborted",
        description: "The migration has been cancelled and all related data has been cleaned up.",
      });
      
      // Reset migration state with abort flag to show success UI
      // The abort flag will be cleared automatically when queries refetch and confirm no pending migrations
      resetMigrationStateWithAbortFlag();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      toast({
        title: "Error",
        description: `Failed to abort migration: ${errorMessage}. Please try again.`,
        variant: "destructive",
      });
    } finally {
      updateMigrationState({ isAborting: false });
    }
  };

  // Show migration steps
  if (migrationState.step !== null) {
    // For pre-checks step, combine progress and content in one card
    if (migrationState.step === MIGRATION_STEPS.PRE_CHECKS) {
      return (
        <CardUI
          title="Wallet Migration"
          description="Migrating your wallet to a new configuration"
          cardClassName="col-span-2"
        >
          <div className="space-y-6">
            <MigrationProgress 
              currentStep={migrationState.step} 
              totalSteps={5}
            />
            <MigrationPreChecks
              appWallet={appWallet}
              onContinue={handlePreChecksContinue}
              onCancel={handlePreChecksCancel}
            />
          </div>
        </CardUI>
      );
    }

    // For other steps, show progress separately
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
          />
        </CardUI>

        {/* Connecting Line */}
        <div className="flex justify-center" aria-hidden="true">
          <div className="w-px h-8 bg-gradient-to-b from-primary/30 to-transparent"></div>
        </div>

        {/* Step Content */}
        <div className="relative">

          {migrationState.step === MIGRATION_STEPS.CREATE_WALLET && (
            <NewWalletCreationStep
              appWallet={appWallet}
              newWalletId={migrationState.newWalletId}
              migrationId={migrationState.migrationId}
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

          {migrationState.step === MIGRATION_STEPS.FUND_TRANSFER && !hasPendingFundTransfer && (
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
              migrationId={migrationState.migrationId}
              onBack={handleArchiveOldWallet}
            />
          )}
        </div>
      </div>
    );
  }

  // Show abort success state
  if (migrationState.hasAborted) {
    return (
      <CardUI
        title="Migration Aborted"
        description="The migration has been successfully cancelled and all related data has been cleaned up."
        cardClassName="col-span-2"
      >
        <div className="space-y-4">
          <Alert className="border-green-200/50 bg-green-50">
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

  // Use walletPendingMigration (checks for ANY migration for this wallet) as primary source
  // Fall back to pendingMigrations for current user if walletPendingMigration is not available
  const pendingMigration = walletPendingMigration || pendingMigrations?.find(
    (migration: any) => migration.originalWalletId === appWallet.id
  );

  // Check if migration is owned by current user
  const isOwnMigration = pendingMigration?.ownerAddress === userAddress;

  // Check if there's any pending migration (including legacy migrationTargetWalletId)
  // But ignore these checks if migration was just aborted (hasAborted flag is set)
  const hasPendingMigration = !migrationState.hasAborted && (
    !!pendingMigration || 
    !!(appWallet as any).migrationTargetWalletId || 
    !!migrationState.newWalletId
  );

  // Show notice card ONLY if:
  // 1. There's an actual pending migration record from database
  // 2. It's NOT owned by current user
  // 3. User is not currently in a migration step
  // 4. User address is available (to properly compare ownership)
  const shouldShowNoticeCard = pendingMigration && 
                                userAddress && 
                                pendingMigration.ownerAddress !== userAddress && 
                                !migrationState.step;

  if (shouldShowNoticeCard) {
    return (
      <CardUI
        title="Migration In Progress"
        description="A migration is currently being processed for this wallet"
        cardClassName="col-span-2"
      >
        <Alert className="border-blue-200/50 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-900/20">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertDescription className="text-blue-800 dark:text-blue-200">
            <strong>Migration Already In Progress</strong>
            {pendingMigration && (
              <div className="mt-3 space-y-2 text-sm">
                <p>A migration is already in progress for this wallet.</p>
                <div className="space-y-1">
                  <p>
                    <strong>Started by:</strong> {pendingMigration.ownerAddress.slice(0, 20)}...
                  </p>
                  <p>
                    <strong>Started:</strong> {new Date(pendingMigration.createdAt).toLocaleString()}
                  </p>
                  {pendingMigration.currentStep !== undefined && (
                    <p>
                      <strong>Current Step:</strong> {pendingMigration.currentStep + 1} of 6
                    </p>
                  )}
                </div>
                <p className="mt-3 pt-3 border-t border-blue-200/50 dark:border-blue-800/50">
                  You cannot start a new migration until the current one is completed or cancelled by the signer who started it.
                </p>
              </div>
            )}
          </AlertDescription>
        </Alert>
      </CardUI>
    );
  }

  // Show initial migration card
  return (
    <CardUI
      title="Migrate Wallet"
      description={hasPendingMigration ? "You have a pending migration" : "Create a new wallet with updated signers and transfer all funds"}
      cardClassName="col-span-2"
    >
      <div className="space-y-6">
        {hasPendingMigration ? (
          <>
            <Alert className="border-amber-200/50 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/20">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                <strong>Pending Migration Found</strong>
                {pendingMigration && (
                  <div className="mt-2 text-sm">
                    <p>Started: {new Date(pendingMigration.createdAt).toLocaleString()}</p>
                    {pendingMigration.currentStep !== undefined && (
                      <p>Current Step: {pendingMigration.currentStep + 1} of 6</p>
                    )}
                  </div>
                )}
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You can continue the migration or cancel it to start fresh.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  variant="destructive"
                  onClick={handleAbortMigrationClick}
                  disabled={migrationState.isAborting}
                  className="flex-1"
                >
                  {migrationState.isAborting ? (
                    <>
                      <Loader className="h-4 w-4 animate-spin mr-2" />
                      Cancelling...
                    </>
                  ) : (
                    <>
                      <X className="h-4 w-4 mr-2" />
                      Cancel Migration
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleStartMigration}
                  disabled={migrationState.isStarting}
                  className="flex-1"
                >
                  {migrationState.isStarting ? (
                    <>
                      <Loader className="h-4 w-4 animate-spin mr-2" />
                      Resuming...
                    </>
                  ) : (
                    <>
                      Continue Migration
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Migration will help you:
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Create a new wallet with updated signers</li>
                <li>Transfer all funds and assets automatically</li>
                <li>Move proxy registrations to the new wallet</li>
                <li>Archive the old wallet when complete</li>
              </ul>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                The migration process includes pre-checks, wallet creation, proxy setup, and fund transfer. 
                You can cancel at any time before completion.
              </AlertDescription>
            </Alert>

            <Button
              onClick={handleStartMigration}
              disabled={migrationState.isStarting}
              className="w-full"
              size="lg"
            >
              {migrationState.isStarting ? (
                <>
                  <Loader className="h-4 w-4 animate-spin mr-2" />
                  Starting Migration...
                </>
              ) : (
                <>
                  Start Migration
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </>
        )}
      </div>

      {/* Abort Confirmation Dialog */}
      <Dialog open={migrationState.showAbortConfirm} onOpenChange={(open) => updateMigrationState({ showAbortConfirm: open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abort Migration?</DialogTitle>
            <DialogDescription>
              Are you sure you want to abort this migration? This action will:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>Delete the new wallet being created (if any)</li>
              <li>Remove all migration records</li>
              <li>Clear migration references from the original wallet</li>
              <li>This action cannot be undone</li>
            </ul>
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Warning:</strong> If funds have already been transferred, you will need to manually transfer them back.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => updateMigrationState({ showAbortConfirm: false })}
              disabled={migrationState.isAborting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleAbortMigrationConfirm}
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardUI>
  );
}
