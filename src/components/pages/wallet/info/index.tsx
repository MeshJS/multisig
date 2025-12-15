import useAppWallet from "@/hooks/useAppWallet";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import CardInfo from "./card-info";
import CardSigners from "./signers/card-signers";
import { MigrateWallet } from "./migrate-wallet";
import { ArchiveWallet } from "./archive-wallet";
import { UpgradeStakingWallet } from "./upgrade-staking-wallet";
import ProxyControlCard from "./proxy-control";
import { UpgradeGovernanceWallet } from "./upgrade-governance-wallet";

export default function WalletInfo() {
  const { appWallet } = useAppWallet();
  const { multisigWallet } = useMultisigWallet();

  if (appWallet === undefined) return <></>;
  
  return (
    <main className="flex w-full flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 md:p-6 lg:gap-8 lg:p-8 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        <CardInfo appWallet={appWallet} />
        <CardSigners appWallet={appWallet} />
        <MigrateWallet appWallet={appWallet} />
        <ProxyControlCard />
        {multisigWallet && <UpgradeStakingWallet mWallet={multisigWallet} appWallet={appWallet} />}
        {multisigWallet && <UpgradeGovernanceWallet mWallet={multisigWallet} />}
        <ArchiveWallet appWallet={appWallet} />
      </div>
    </main>
  );
}
