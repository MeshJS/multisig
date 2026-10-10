import useAppWallet from "@/hooks/useAppWallet";
import WalletAssets from "./wallet-assets";
import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";

export default function PageTransactions() {
  const { appWallet } = useAppWallet();

  if (appWallet === undefined) return <WalletDetailSkeleton />;

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <WalletAssets appWallet={appWallet} />
      </div>
    </main>
  );
}
