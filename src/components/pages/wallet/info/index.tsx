import useAppWallet from "@/hooks/useAppWallet";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import CardInfo from "./card-info";
import CardSigners from "./signers/card-signers";
import InspectScript from "./inspect-script";
import { MigrateWallet } from "./migrate-wallet";
import { ArchiveWallet } from "./archive-wallet";
import InspectMultisigScript from "@/components/multisig/inspect-multisig-script";
import { UpgradeStakingWallet } from "./upgrade-staking-wallet";

export default function WalletInfo() {
  const { appWallet } = useAppWallet();
  const { multisigWallet } = useMultisigWallet();

  if (appWallet === undefined) return <></>;
  return (
    <>
      <main className="flex w-full flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <div className="grid grid-cols-1 gap-4">
          <CardInfo appWallet={appWallet} />
          <CardSigners appWallet={appWallet} />
          <InspectMultisigScript mWallet={multisigWallet} />
          <UpgradeStakingWallet mWallet={multisigWallet} />
          <ArchiveWallet appWallet={appWallet} />
          <MigrateWallet appWallet={appWallet} />
        </div>
      </main>
    </>
  );
}
