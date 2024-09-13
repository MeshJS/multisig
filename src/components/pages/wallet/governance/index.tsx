import { Wallet } from "@/types/wallet";
import CardInfo from "./card-info";

export default function TabGovernance({ appWallet }: { appWallet: Wallet }) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <CardInfo appWallet={appWallet} />
      </div>
    </main>
  );
}
