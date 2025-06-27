import { Button } from "@/components/ui/button";

import WalletInfoCard from "@/components/pages/homepage/wallets/new-wallet-flow/save/nWInfoCard";
import SignerInfoCard from "@/components/pages/homepage/wallets/new-wallet-flow/save/nWSignerInfoCard";
import WalletFlowPageLayout from "@/components/pages/homepage/wallets/new-wallet-flow/shared/WalletFlowPageLayout";
import { useWalletFlowState } from "@/components/pages/homepage/wallets/new-wallet-flow/shared/useWalletFlowState";

export default function PageNewWallet() {
  const walletFlow = useWalletFlowState();

  return (
    <WalletFlowPageLayout currentStep={1}>
      {walletFlow.user && (
        <>
          {/* Wallet Info */}
          <WalletInfoCard
            walletInfo={{
              name: walletFlow.name,
              setName: walletFlow.setName,
              description: walletFlow.description,
              setDescription: walletFlow.setDescription,
            }}
          />
          
          {/* Your Signer Info */}
          <SignerInfoCard
            signerInfo={{
              address: walletFlow.user?.address || "",
              stakeKey: walletFlow.user?.stakeAddress || "",
              description: walletFlow.signersDescriptions[0] || "",
              setDescription: (desc: string) => {
                const updatedDescriptions = [...walletFlow.signersDescriptions];
                updatedDescriptions[0] = desc;
                walletFlow.setSignerDescriptions(updatedDescriptions);
              },
            }}
          />

          {/* Action Section - Save Button aligned right like Create button */}
          <div className="mt-6 sm:mt-8 flex justify-end">
            <Button
              onClick={() => void walletFlow.handleCreateNewWallet()}
              disabled={!walletFlow.isValidForSave}
              className="w-full sm:w-auto"
              size="lg"
            >
              {walletFlow.loading ? "Saving..." : "Save & Continue"}
            </Button>
          </div>
        </>
      )}
    </WalletFlowPageLayout>
  );
}
