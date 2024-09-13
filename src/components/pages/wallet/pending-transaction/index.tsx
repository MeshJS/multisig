import TransactionCard from "./transaction-card";
import usePendingTransactions from "@/hooks/usePendingTransactions";

export default function TabPendingTransactions({
  walletId,
}: {
  walletId: string;
}) {
  const { transactions } = usePendingTransactions({ walletId });

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
        {transactions &&
          transactions.map((transaction) => {
            return (
              <TransactionCard
                key={transaction.id}
                walletId={walletId}
                transaction={transaction}
              />
            );
          })}
      </div>
    </main>
  );
}
