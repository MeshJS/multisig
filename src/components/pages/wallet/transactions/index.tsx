import { Wallet } from "@/types/wallet";
import AllTransactions from "./all-transactions";

export default function TabTransactions({ appWallet }: { appWallet: Wallet }) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
        <AllTransactions appWallet={appWallet} />
      </div>
    </main>
  );
}
