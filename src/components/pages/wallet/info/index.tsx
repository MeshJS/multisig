import { Wallet } from "@/types/wallet";
import CardInfo from "./card-info";
import CardSigners from "./card-signers";
import InspectScript from "./inspect-script";

export default function TabInfo({ appWallet }: { appWallet: Wallet }) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <CardInfo appWallet={appWallet} />
        <CardSigners appWallet={appWallet} />
        <InspectScript appWallet={appWallet} />
      </div>
    </main>
  );
}
