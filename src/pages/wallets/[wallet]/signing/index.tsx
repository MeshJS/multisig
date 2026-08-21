import WalletSigning from "@/components/pages/wallet/signing";

export const getServerSideProps = () => ({ props: {} });

export default function PageWalletInfo() {
  return <WalletSigning />;
}
