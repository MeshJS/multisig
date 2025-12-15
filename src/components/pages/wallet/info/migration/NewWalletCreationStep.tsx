import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Loader } from "lucide-react";
import { Wallet } from "@/types/wallet";
import ReviewWalletInfoCard from "@/components/pages/homepage/wallets/new-wallet-flow/create/ReviewWalletInfoCard";
import ReviewSignersCard from "@/components/pages/homepage/wallets/new-wallet-flow/create/ReviewSignersCard";
import ReviewRequiredSignersCard from "@/components/pages/homepage/wallets/new-wallet-flow/create/ReviewRequiredSignersCard";
import CollapsibleAdvancedSection from "@/components/pages/homepage/wallets/new-wallet-flow/create/CollapsibleAdvancedSection";
import { useMigrationWalletFlowState } from "./useMigrationWalletFlowState";

interface NewWalletCreationStepProps {
  appWallet: Wallet;
  onBack: () => void;
  onContinue: (newWalletId: string) => void;
}

export default function NewWalletCreationStep({ 
  appWallet, 
  onBack, 
  onContinue 
}: NewWalletCreationStepProps) {
  const walletFlow = useMigrationWalletFlowState(appWallet);
  const hasAttemptedTemporaryWallet = React.useRef(false);

  const handleCreateWallet = async () => {
    const finalWalletId = await walletFlow.createMigrationWallet();
    
    if (finalWalletId !== null) {
      onContinue(finalWalletId);
    }
  };

  // Create temporary wallet on mount to enable invite link
  React.useEffect(() => {
    if (!walletFlow.newWalletId && 
        walletFlow.name && 
        walletFlow.signersAddresses.length > 0 && 
        !walletFlow.loading && 
        !hasAttemptedTemporaryWallet.current) {
      hasAttemptedTemporaryWallet.current = true;
      walletFlow.createTemporaryWallet();
    }
  }, [walletFlow.name, walletFlow.signersAddresses.length, walletFlow.newWalletId, walletFlow.loading, walletFlow.createTemporaryWallet]);

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
          {!walletFlow.newWalletId && (
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

          {walletFlow.newWalletId && appWallet.migrationTargetWalletId && (
            <div className="flex items-start gap-2 p-4 bg-amber-50 border border-amber-200/50 rounded-lg">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="text-sm text-amber-800">
                <strong>Final Wallet Already Created:</strong> The final wallet for this migration has already been created. You can only create one new wallet per migration.
              </p>
            </div>
          )}
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
          
          {!walletFlow.newWalletId ? (
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
            <div className="flex gap-3 flex-1 sm:flex-none">
              {/* Only show Create Final Wallet button if no final wallet has been created yet */}
              {!appWallet.migrationTargetWalletId && (
                <Button
                  onClick={handleCreateWallet}
                  disabled={!walletFlow.isValidForCreate || walletFlow.loading}
                  variant="outline"
                  className="flex-1"
                >
                  {walletFlow.loading ? (
                    <>
                      <Loader className="h-4 w-4 mr-2 animate-spin" />
                      Creating Final Wallet...
                    </>
                  ) : (
                    <>
                      Create Final Wallet
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              )}
              
              {/* Show appropriate continue button based on whether final wallet exists */}
              {appWallet.migrationTargetWalletId && (
                <Button
                  onClick={() => onContinue(appWallet.migrationTargetWalletId!)}
                  className="flex-1"
                  size="lg"
                >
                  Continue to Fund Transfer
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
