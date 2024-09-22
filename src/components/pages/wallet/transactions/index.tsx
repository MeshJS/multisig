import { Wallet } from "@/types/wallet";
import AllTransactions from "./all-transactions";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import TransactionCard from "./transaction-card";
import CardBalance from "./card-balance";
import CardPendingTx from "./card-pending-tx";
import SectionTitle from "@/components/common/section-title";

export default function TabTransactions({ appWallet }: { appWallet: Wallet }) {
  const { transactions: pendingTransactions } = usePendingTransactions({
    walletId: appWallet.id,
  });

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <CardBalance appWallet={appWallet} />
        <CardPendingTx appWallet={appWallet} />
      </div>

      {pendingTransactions && pendingTransactions.length > 0 && (
        <>
          <SectionTitle>Pending Transactions</SectionTitle>
          <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
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
        </>
      )}

      <SectionTitle>All Transactions</SectionTitle>
      <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
        <AllTransactions appWallet={appWallet} />
      </div>
    </main>
  );
}
