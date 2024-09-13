import { Wallet } from "@/types/wallet";
import InspectScript from "./inspect-script";

export default function TabDetails({ appWallet }: { appWallet: Wallet }) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
        <InspectScript appWallet={appWallet} />
      </div>
    </main>
  );
}
