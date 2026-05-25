/**
 * Import Wallet wizard — single-page, three internal steps.
 *
 * Mirrors the visual shell of new-wallet-flow but skips the NewWallet
 * draft round trip: the import sources arrive with a fully-resolved
 * wallet config (or, for CBOR paste, enough to reconstruct one), so we
 * collect, review, then write straight to Wallet via importWallet.
 */

import WalletFlowPageLayout from "@/components/pages/homepage/wallets/new-wallet-flow/shared/WalletFlowPageLayout";
import ProgressIndicator from "@/components/pages/homepage/wallets/new-wallet-flow/shared/ProgressIndicator";

import { useWalletImportFlowState } from "./shared/useWalletImportFlowState";
import SourceStep from "./source";
import ReviewStep from "./review";
import ReadyStep from "./ready";

const STEPS = [
  { label: "Source", description: "Choose where the wallet comes from" },
  { label: "Review", description: "Confirm signers and policy" },
  { label: "Ready", description: "Wallet appears in your sidebar" },
] as const;

export default function PageImportWallet() {
  const flow = useWalletImportFlowState();
  const currentStep = flow.step === "source" ? 1 : flow.step === "review" ? 2 : 3;

  return (
    <div className="min-h-screen w-full overflow-x-hidden px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-3 sm:mb-6">
          <h1 className="text-lg font-bold text-foreground sm:text-2xl">
            Import Wallet
          </h1>
        </div>
        <div className="mb-4 sm:mb-8">
          <ProgressIndicator currentStep={currentStep} steps={[...STEPS]} />
        </div>
        <div className="space-y-3 sm:space-y-6">
          {flow.step === "source" && <SourceStep flow={flow} />}
          {flow.step === "review" && <ReviewStep flow={flow} />}
          {flow.step === "ready" && <ReadyStep flow={flow} />}
        </div>
      </div>
    </div>
  );
}

// Re-export the layout in case future steps want to drop into it directly.
export { WalletFlowPageLayout };
