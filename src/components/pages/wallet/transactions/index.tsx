import AllTransactions from "./all-transactions";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import TransactionCard from "./transaction-card";
import CardBalance from "./card-balance";
import SectionTitle from "@/components/ui/section-title";
import useAppWallet from "@/hooks/useAppWallet";

export default function PageTransactions() {
  const { appWallet } = useAppWallet();

  const { transactions: pendingTransactions } = usePendingTransactions({
    walletId: appWallet && appWallet.id,
  });

  if (appWallet === undefined) return <></>;

  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:gap-6 sm:p-4 md:gap-8 md:p-8 max-w-7xl mx-auto">
      {/* Balance Card */}
      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        <CardBalance appWallet={appWallet} />
      </div>

      {/* Pending Transactions */}
      {pendingTransactions && pendingTransactions.length > 0 && (
        <div className="space-y-4 sm:space-y-6">
          <div className="flex flex-col gap-2">
            <SectionTitle>Pending Transactions</SectionTitle>
            <p className="text-sm text-muted-foreground">
              Transactions waiting for signatures from other wallet members
            </p>
          </div>
          <div className="grid gap-4 sm:gap-6 md:gap-8 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
            {pendingTransactions.map((tx) => {
              return (
                <TransactionCard
                  key={tx.id}
                  walletId={appWallet.id}
                  transaction={tx}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* All Transactions */}
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-2">
          <SectionTitle>All Transactions</SectionTitle>
          <p className="text-sm text-muted-foreground">
            Complete history of all transactions for this wallet
          </p>
        </div>
        <div className="grid gap-4 sm:gap-6 md:gap-8 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
          <AllTransactions appWallet={appWallet} />
        </div>
      </div>
    </main>
  );
}
