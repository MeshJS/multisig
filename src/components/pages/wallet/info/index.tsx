import CardInfo from "./card-info";
import CardSigners from "./card-signers";
import InspectScript from "./inspect-script";
import useAppWallet from "@/hooks/useAppWallet";
import { MigrateWallet } from "./migrate-wallet";
import { ArchiveWallet } from "./archive-wallet";

export default function WalletInfo() {
  const { appWallet } = useAppWallet();

  if (appWallet === undefined) return <></>;
  return (
    <>
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <CardInfo appWallet={appWallet} />
          <CardSigners appWallet={appWallet} />
          <InspectScript appWallet={appWallet} />
          <ArchiveWallet appWallet={appWallet} />
          <MigrateWallet appWallet={appWallet} />
        </div>
      </main>
    </>
  );
}
