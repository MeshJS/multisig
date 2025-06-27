/**
 * Enhanced Add Wallet Page
 * Adds subtle glass morphism without breaking functionality
 */

import PageNewWallet from "@/components/pages/homepage/wallets/new-wallet-flow/save";
import GlassMorphismPageWrapper from "@/components/pages/homepage/wallets/new-wallet-flow/shared/GlassMorphismPageWrapper";

export default function Page() {
  return (
    <GlassMorphismPageWrapper>
      <PageNewWallet />
    </GlassMorphismPageWrapper>
  );
}