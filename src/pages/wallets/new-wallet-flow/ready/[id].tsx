/**
 * Enhanced Success Page with Glass Morphism
 * Same subtle effect as Add Wallet page
 */

import PageSuccessWallet from "@/components/pages/homepage/wallets/new-wallet-flow/ready";
import GlassMorphismPageWrapper from "@/components/pages/homepage/wallets/new-wallet-flow/shared/GlassMorphismPageWrapper";

export default function Page() {
  return (
    <GlassMorphismPageWrapper>
      <PageSuccessWallet />
    </GlassMorphismPageWrapper>
  );
}