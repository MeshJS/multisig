/**
 * Enhanced Add Wallet Page
 * Adds subtle glass morphism without breaking functionality
 */

import PageNewWallet from "@/components/pages/homepage/wallets/new-wallet-flow/save";
import GlobePageWrapper from "@/components/pages/homepage/wallets/new-wallet-flow/shared/GlobePageWrapper";

export default function Page() {
  return (
    <GlobePageWrapper>
      <PageNewWallet />
    </GlobePageWrapper>
  );
}