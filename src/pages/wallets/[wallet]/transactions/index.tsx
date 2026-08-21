import PageTransactions from "@/components/pages/wallet/transactions";

export const getServerSideProps = () => ({ props: {} });

export default function PageWalletTransactions() {
  return <PageTransactions />;
}
