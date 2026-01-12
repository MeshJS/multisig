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
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6 lg:gap-8 lg:p-8">
      <div className="w-full">
        <CardBalance appWallet={appWallet} />
      </div>

      {pendingTransactions && pendingTransactions.length > 0 && (
        <>
          <SectionTitle>Pending Transactions</SectionTitle>
          <div className={`flex justify-center w-full`}>
            <div
              className={`grid gap-4 w-full ${
                pendingTransactions.length === 1
                  ? "max-w-4xl"
                  : pendingTransactions.length === 2
                  ? "max-w-7xl sm:grid-cols-2"
                  : "max-w-[90rem] sm:grid-cols-2 lg:grid-cols-3"
              }`}
            >
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
        </>
      )}
      <SectionTitle>All Transactions</SectionTitle>
      <div className="w-full">
        <AllTransactions appWallet={appWallet} />
      </div>
    </main>
  );
}
