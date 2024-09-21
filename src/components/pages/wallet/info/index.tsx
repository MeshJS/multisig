import { Wallet } from "@/types/wallet";
import CardBalance from "./card-balance";
import CardInfo from "./card-info";
import CardPendingTx from "./card-pending-tx";
import CardSigners from "./card-signers";
import InspectScript from "./inspect-script";

export default function TabInfo({ appWallet }: { appWallet: Wallet }) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <CardBalance appWallet={appWallet} />
        <CardPendingTx appWallet={appWallet} />
        <CardSigners appWallet={appWallet} />
        <CardInfo appWallet={appWallet} />
        <InspectScript appWallet={appWallet} />
      </div>
    </main>
  );
}
