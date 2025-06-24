/**
 * Enhanced Review Page with Glass Morphism
 * Same subtle effect as Add Wallet page
 */

import PageReviewWallet from "@/components/pages/homepage/wallets/new-wallet-flow/create";
import GlassMorphismPageWrapper from "@/components/pages/homepage/wallets/new-wallet-flow/shared/GlassMorphismPageWrapper";

export default function Page() {
  return (
    <GlassMorphismPageWrapper>
      <PageReviewWallet />
    </GlassMorphismPageWrapper>
  );
}