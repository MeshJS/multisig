import { Wallet } from "@/types/wallet";
import CardBalance from "./card-balance";
import CardInfo from "./card-info";
import CardPendingTx from "./card-pending-tx";
import CardSigners from "./card-signers";

export default function TabInfo({ appWallet }: { appWallet: Wallet }) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
        <CardBalance appWallet={appWallet} />
        <CardPendingTx appWallet={appWallet} />
        <div className="col-span-2"></div>
        <CardInfo appWallet={appWallet} />
        <div className="col-span-2"></div>
        <CardSigners appWallet={appWallet} />
      </div>
    </main>
  );
}
