import ReviewWalletInfoCard from "@/components/pages/homepage/wallets/new-wallet-flow/create/ReviewWalletInfoCard";
import ReviewSignersCard from "@/components/pages/homepage/wallets/new-wallet-flow/create/ReviewSignersCard";
import ReviewRequiredSignersCard from "@/components/pages/homepage/wallets/new-wallet-flow/create/ReviewRequiredSignersCard";
import CollapsibleAdvancedSection from "@/components/pages/homepage/wallets/new-wallet-flow/create/CollapsibleAdvancedSection";
import { Button } from "@/components/ui/button";
import WalletFlowPageLayout from "@/components/pages/homepage/wallets/new-wallet-flow/shared/WalletFlowPageLayout";
import { useWalletFlowState } from "@/components/pages/homepage/wallets/new-wallet-flow/shared/useWalletFlowState";
import { Check } from "lucide-react";

export default function PageReviewWallet() {
  const walletFlow = useWalletFlowState();


  return (
    <WalletFlowPageLayout currentStep={2}>
      {walletFlow.user && (
        <>
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

          {/* Signers - moved to second position */}
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
            walletId={walletFlow.walletInviteId || walletFlow.router.query.id as string}
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

          {/* Advanced Section - Single Collapsible */}
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

          {/* Action Section - Warning and Create Button */}
          <div className="mt-6 sm:mt-8 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:justify-between">
              {/* Warning Message */}
              <div className="flex items-start gap-2 p-4 bg-muted/50 rounded-lg w-fit">
                <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {walletFlow.usesStored && !walletFlow.hasValidRawImportBodies ? (
                  <p className="text-sm text-foreground">
                    <strong>Not yet compatible:</strong> This wallet was created with a stored script format that is not supported for creation here yet. Please check back soon.
                  </p>
                ) : walletFlow.hasSignerHashInAddresses ? (
                  <p className="text-sm text-foreground">
                    <strong>Invite not completed:</strong> Not all signers visited the invite link.
                  </p>
                ) : (
                  <p className="text-sm text-foreground">
                    <strong>Important:</strong> Creation is final - signers and rules can not be changed afterwards.
                  </p>
                )}
              </div>
              {/* Create Button */}
              <Button
                onClick={walletFlow.createNativeScript}
                disabled={!walletFlow.isValidForCreate || (walletFlow.usesStored && !walletFlow.hasValidRawImportBodies)}
                className="w-full sm:w-auto"
                size="lg"
              >
                {walletFlow.loading ? "Creating..." : "Create"}
              </Button>
            </div>
            {/* Bypass option for hash signers */}
            {walletFlow.hasSignerHashInAddresses && (
              <button
                type="button"
                onClick={() => {
                  walletFlow.setAllowCreateWithHashSigners(!walletFlow.allowCreateWithHashSigners);
                }}
                className="flex items-center space-x-2 p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors w-full text-left"
              >
                <div className={`flex items-center justify-center h-5 w-5 rounded border-2 transition-colors ${
                  walletFlow.allowCreateWithHashSigners 
                    ? "bg-primary border-primary" 
                    : "border-muted-foreground/50"
                }`}>
                  {walletFlow.allowCreateWithHashSigners && (
                    <Check className="h-4 w-4 text-primary-foreground" />
                  )}
                </div>
                <span className="text-sm font-normal select-none flex-1">
                  I understand that not all signers have visited the invite link. Create wallet anyway.
                </span>
              </button>
            )}
          </div>
        </>
      )}
    </WalletFlowPageLayout>
  );
}
