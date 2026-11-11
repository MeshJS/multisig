import useAppWallet from "@/hooks/useAppWallet";
import WalletAssets from "./wallet-assets";
import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";

export default function PageTransactions() {
  const { appWallet } = useAppWallet();

  if (appWallet === undefined) return <WalletDetailSkeleton />;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div data-testid="assets-content" className="flex min-w-0 flex-col gap-4">
        <WalletAssets appWallet={appWallet} />
      </div>
    </main>
  );
}
