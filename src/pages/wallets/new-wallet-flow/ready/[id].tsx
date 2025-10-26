/**
 * Enhanced Success Page with Glass Morphism
 * Same subtle effect as Add Wallet page
 */

import PageSuccessWallet from "@/components/pages/homepage/wallets/new-wallet-flow/ready";
import GlobePageWrapper from "@/components/pages/homepage/wallets/new-wallet-flow/shared/GlobePageWrapper";

export default function Page() {
  return (
    <GlobePageWrapper>
      <PageSuccessWallet />
    </GlobePageWrapper>
  );
}