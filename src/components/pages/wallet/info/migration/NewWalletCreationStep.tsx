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

  const handleCreateWallet = async () => {
    await walletFlow.createMigrationWallet();
  };

  // Watch for newWalletId changes and continue when wallet is created
  React.useEffect(() => {
    console.log("NewWalletCreationStep: newWalletId changed", walletFlow.newWalletId);
    if (walletFlow.newWalletId) {
      console.log("NewWalletCreationStep: calling onContinue with", walletFlow.newWalletId);
      onContinue(walletFlow.newWalletId);
    }
  }, [walletFlow.newWalletId, onContinue]);

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
        {/* Warning Message */}
        <div className="flex items-start gap-2 p-4 bg-muted/50 rounded-lg w-fit">
          <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-foreground">
            <strong>Important:</strong> Creation is final - signers and rules can not be changed afterwards.
          </p>
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
          <Button
            onClick={handleCreateWallet}
            disabled={!walletFlow.isValidForCreate || walletFlow.loading}
            className="flex-1 sm:flex-none"
            size="lg"
          >
            {walletFlow.loading ? (
              <>
                <Loader className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Create Wallet
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
