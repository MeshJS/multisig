import { Wallet } from "@/types/wallet";
import AllTransactions from "./all-transactions";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import TransactionCard from "./transaction-card";

export default function TabTransactions({ appWallet }: { appWallet: Wallet }) {
  const { transactions } = usePendingTransactions({ walletId: appWallet.id });

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      {transactions && transactions.length > 0 && (
        <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
          {transactions.map((transaction) => {
            return (
              <TransactionCard
                key={transaction.id}
                walletId={appWallet.id}
                transaction={transaction}
              />
            );
          })}
        </div>
      )}
      <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
        <AllTransactions appWallet={appWallet} />
      </div>
    </main>
  );
}
