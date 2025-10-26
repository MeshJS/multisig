/**
 * Enhanced Review Page with Glass Morphism
 * Same subtle effect as Add Wallet page
 */

import PageReviewWallet from "@/components/pages/homepage/wallets/new-wallet-flow/create";
import GlobePageWrapper from "@/components/pages/homepage/wallets/new-wallet-flow/shared/GlobePageWrapper";

export default function Page() {
  return (
    <GlobePageWrapper>
      <PageReviewWallet />
    </GlobePageWrapper>
  );
}