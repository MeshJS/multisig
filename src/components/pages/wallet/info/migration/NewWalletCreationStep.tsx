import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Loader } from "lucide-react";
import { Wallet } from "@/types/wallet";
import ReviewWalletInfoCard from "@/components/pages/homepage/wallets/new-wallet-flow/create/ReviewWalletInfoCard";
import ReviewSignersCard from "@/components/pages/homepage/wallets/new-wallet-flow/create/ReviewSignersCard";
import ReviewRequiredSignersCard from "@/components/pages/homepage/wallets/new-wallet-flow/create/ReviewRequiredSignersCard";
import CollapsibleAdvancedSection from "@/components/pages/homepage/wallets/new-wallet-flow/create/CollapsibleAdvancedSection";
import { useMigrationWalletFlowState } from "./useMigrationWalletFlowState";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";

interface NewWalletCreationStepProps {
  appWallet: Wallet;
  newWalletId?: string | null;
  migrationId?: string | null;
  onBack: () => void;
  onContinue: (newWalletId: string) => void;
}

export default function NewWalletCreationStep({ 
  appWallet,
  newWalletId: propNewWalletId,
  migrationId,
  onBack, 
  onContinue 
}: NewWalletCreationStepProps) {
  const walletFlow = useMigrationWalletFlowState(appWallet, migrationId);
  const hasAttemptedTemporaryWallet = React.useRef(false);
  const { userAddress } = useUserStore();
  const utils = api.useUtils();
  
  // Use prop newWalletId if provided, otherwise use walletFlow's newWalletId
  const effectiveNewWalletId = propNewWalletId || walletFlow.newWalletId;
  
  // Sync propNewWalletId to appWallet so walletFlow can find it
  // This is a workaround since walletFlow checks appWallet.migrationTargetWalletId
  React.useEffect(() => {
    if (propNewWalletId && !(appWallet as any).migrationTargetWalletId) {
      // Temporarily set migrationTargetWalletId so walletFlow can find it
      (appWallet as any).migrationTargetWalletId = propNewWalletId;
    }
  }, [propNewWalletId, appWallet]);

  // Check if final wallet already exists (only once on mount)
  const hasCheckedExistingWallet = React.useRef(false);
  
  React.useEffect(() => {
    const checkExistingWallet = async () => {
      if (hasCheckedExistingWallet.current) return;
      
      // Check migrationTargetWalletId first, then effectiveNewWalletId
      const migrationTargetId = (appWallet as any).migrationTargetWalletId || effectiveNewWalletId;
      
      if (migrationTargetId && userAddress) {
        hasCheckedExistingWallet.current = true;
        
        try {
          // Try to fetch as Wallet (final wallet)
          const walletData = await utils.wallet.getWallet.fetch({
            address: userAddress,
            walletId: migrationTargetId,
          });
          
          if (walletData) {
            // Final wallet exists, automatically continue to next step
            onContinue(migrationTargetId);
            return;
          }
        } catch (error) {
          // Wallet doesn't exist as final wallet, check if it's a NewWallet
          try {
            const newWalletData = await utils.wallet.getNewWallet.fetch({
              walletId: migrationTargetId,
            });
            
            if (newWalletData) {
              // Temporary wallet exists, load it but don't auto-continue
              // The walletFlow should load it via existingNewWallet query
              return;
            }
          } catch (newWalletError) {
            // Neither exists, continue with normal flow
            hasCheckedExistingWallet.current = false; // Reset if check failed
          }
        }
      }
    };

    checkExistingWallet();
  }, [appWallet, userAddress, effectiveNewWalletId, utils, onContinue]);

  const handleCreateWallet = async () => {
    // Check if wallet already exists before creating
    const migrationTargetId = (appWallet as any).migrationTargetWalletId || effectiveNewWalletId;
    
    if (migrationTargetId && userAddress) {
      try {
        // First check if it's a final Wallet
        const walletData = await utils.wallet.getWallet.fetch({
          address: userAddress,
          walletId: migrationTargetId,
        });
        
        if (walletData) {
          // Final wallet already exists, just continue
          onContinue(migrationTargetId);
          return;
        }
      } catch (error) {
        // Not a final wallet, check if it's a NewWallet
        try {
          const newWalletData = await utils.wallet.getNewWallet.fetch({
            walletId: migrationTargetId,
          });
          
          if (newWalletData) {
            // Temporary wallet exists, create final wallet from it
            const finalWalletId = await walletFlow.createMigrationWallet();
            if (finalWalletId !== null) {
              onContinue(finalWalletId);
            }
            return;
          }
        } catch (newWalletError) {
          // Neither exists, proceed with creation
        }
      }
    }
    
    // No existing wallet found, create new one
    const finalWalletId = await walletFlow.createMigrationWallet();
    
    if (finalWalletId !== null) {
      onContinue(finalWalletId);
    }
  };

  // Create temporary wallet on mount to enable invite link
  // BUT only if no wallet exists yet (neither final nor temporary)
  React.useEffect(() => {
    // PRIORITY CHECK: Don't create if propNewWalletId is provided (continuing migration)
    // This must be checked FIRST before any other checks
    if (propNewWalletId) {
      return; // We're continuing a migration, don't create new wallet
    }
    
    // Don't create if we already have a wallet ID (from props or walletFlow)
    if (effectiveNewWalletId) {
      return; // Wallet already exists, don't create
    }
    
    // Don't create if migration target wallet exists
    if ((appWallet as any).migrationTargetWalletId) {
      return; // Migration target exists, don't create temporary wallet
    }
    
    // Only create if all conditions are met AND we're not continuing a migration
    if (!walletFlow.newWalletId && 
        walletFlow.name && 
        walletFlow.signersAddresses.length > 0 && 
        !walletFlow.loading && 
        !hasAttemptedTemporaryWallet.current &&
        !propNewWalletId) { // Extra check for propNewWalletId
      hasAttemptedTemporaryWallet.current = true;
      walletFlow.createTemporaryWallet();
    }
  }, [walletFlow.name, walletFlow.signersAddresses.length, walletFlow.newWalletId, walletFlow.loading, walletFlow.createTemporaryWallet, effectiveNewWalletId, propNewWalletId, appWallet]);

  // Don't automatically continue - let user decide when to proceed
  // React.useEffect(() => {
  //   console.log("NewWalletCreationStep: newWalletId changed", walletFlow.newWalletId);
  //   if (walletFlow.newWalletId) {
  //     console.log("NewWalletCreationStep: calling onContinue with", walletFlow.newWalletId);
  //     onContinue(walletFlow.newWalletId);
  //   }
  // }, [walletFlow.newWalletId, onContinue]);

  return (
    <div className="space-y-6">
      {/* Wallet Info */}
      <ReviewWalletInfoCard
        walletInfo={{
          name: walletFlow.name,
          setName: walletFlow.setName,
          description: walletFlow.description,
          setDescription: walletFlow.setDescription,
        }}
        onSave={walletFlow.handleSaveWalletInfo}
      />

      {/* Signers */}
      <ReviewSignersCard
        signerConfig={{
          signersAddresses: walletFlow.signersAddresses,
          setSignerAddresses: walletFlow.setSignerAddresses,
          signersDescriptions: walletFlow.signersDescriptions,
          setSignerDescriptions: walletFlow.setSignerDescriptions,
          signersStakeKeys: walletFlow.signersStakeKeys,
          setSignerStakeKeys: walletFlow.setSignerStakeKeys,
          signersDRepKeys: walletFlow.signersDRepKeys,
          setSignerDRepKeys: walletFlow.setSignerDRepKeys,
          addSigner: walletFlow.addSigner,
          removeSigner: walletFlow.removeSigner,
        }}
        currentUserAddress={walletFlow.userAddress}
        walletId={walletFlow.newWalletId || ""}
        hasExternalStakeCredential={!!walletFlow.stakeKey}
        onSave={walletFlow.handleSaveSigners}
      />

      {/* Required Signatures */}
      <ReviewRequiredSignersCard
        requiredSignersConfig={{
          numRequiredSigners: walletFlow.numRequiredSigners,
          setNumRequiredSigners: walletFlow.setNumRequiredSigners,
          nativeScriptType: walletFlow.nativeScriptType,
          signersCount: walletFlow.signersAddresses.length,
        }}
        onSave={walletFlow.handleSaveSignatureRules}
      />

      {/* Advanced Section */}
      <CollapsibleAdvancedSection
        advancedConfig={{
          stakeKey: walletFlow.stakeKey,
          setStakeKey: walletFlow.setStakeKey,
          nativeScriptType: walletFlow.nativeScriptType,
          setNativeScriptType: walletFlow.setNativeScriptType,
          removeExternalStakeAndBackfill: walletFlow.removeExternalStakeAndBackfill,
        }}
        mWallet={walletFlow.multisigWallet}
        onSave={walletFlow.handleSaveAdvanced}
      />


      {/* Action Section */}
      <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:justify-between">
        {/* Info Messages */}
        <div className="space-y-3">
          {!effectiveNewWalletId && (
            <div className="flex items-start gap-2 p-4 bg-blue-50 border border-blue-200/50 rounded-lg">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-blue-800">
                <strong>Step 1:</strong> Configure your wallet settings and generate an invite link to share with other signers.
              </p>
            </div>
          )}
          
          <div className="flex items-start gap-2 p-4 bg-muted/50 rounded-lg">
            <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-foreground">
              <strong>Important:</strong> Final wallet creation is permanent - signers and rules cannot be changed afterwards.
            </p>
          </div>

        </div>
        
        {/* Action Buttons */}
        <div className="flex gap-3 w-full sm:w-auto">
          <Button
            variant="outline"
            onClick={onBack}
            className="flex-1 sm:flex-none"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          
          {!effectiveNewWalletId ? (
            <Button
              onClick={handleCreateWallet}
              disabled={!walletFlow.isValidForCreate || walletFlow.loading}
              className="flex-1 sm:flex-none"
              size="lg"
            >
              {walletFlow.loading ? (
                <>
                  <Loader className="h-4 w-4 mr-2 animate-spin" />
                  Creating Temporary Wallet...
                </>
              ) : (
                <>
                  Generate Invite Link
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleCreateWallet}
              disabled={!walletFlow.isValidForCreate || walletFlow.loading}
              className="flex-1 sm:flex-none"
              size="lg"
            >
              {walletFlow.loading ? (
                <>
                  <Loader className="h-4 w-4 mr-2 animate-spin" />
                  Creating Final Wallet...
                </>
              ) : appWallet.migrationTargetWalletId ? (
                <>
                  Continue to Fund Transfer
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              ) : (
                <>
                  Create Final Wallet and Continue to Transfer Funds
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
