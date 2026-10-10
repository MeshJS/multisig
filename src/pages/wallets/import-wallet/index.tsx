/**
 * Import Wallet route.
 *
 * Wrapped in the same GlassMorphismPageWrapper as the new-wallet-flow so
 * the two flows feel visually paired.
 */
import PageImportWallet from "@/components/pages/homepage/wallets/import-wallet-flow";
import GlassMorphismPageWrapper from "@/components/pages/homepage/wallets/new-wallet-flow/shared/GlassMorphismPageWrapper";

export const getServerSideProps = () => ({ props: {} });

export default function Page() {
  return (
    <GlassMorphismPageWrapper>
      <PageImportWallet />
    </GlassMorphismPageWrapper>
  );
}
