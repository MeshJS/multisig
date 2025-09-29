import {useMemo} from "react";

import type { MultisigWallet } from "@/utils/multisigSDK";
import { useWalletsStore } from "@/lib/zustand/wallets";

import CardUI from "@/components/ui/card-content";

export function UpgradeGovernanceWallet({
  mWallet,
}: {
  mWallet?: MultisigWallet;
}) {
  const drepInfo = useWalletsStore((state) => state.drepInfo);

  const upgraded = useMemo(() => {
    return mWallet?.isGovernanceEnabled();
  }, [mWallet]);

  if (!mWallet || upgraded ) return null;

  return (
    <CardUI
      title="Upgrade Wallet for Governance"
      description="Add a drep key script to your multisig Wallet."
      cardClassName="col-span-2"
    >
      {!mWallet.drepEnabled() && (!drepInfo || !drepInfo.active) && (
        <div>
          Not all drep keys have been added. Click Edit Signers to add your
          drep key!
        </div>
      )}
      {!mWallet.drepEnabled() && drepInfo && drepInfo.active && (
        <div>
          ⚠️ DRep is currently registered. You must deregister the DRep before adding new DRep keys.
          Go to the Governance section to deregister your DRep first.
        </div>
      )}
      {mWallet.drepEnabled() && drepInfo && !drepInfo.active && (
        <div>
          DRep keys have been added to the wallet, but the DRep is not yet registered. 
          Go to the Governance section to register your DRep.
        </div>
      )}
      {mWallet.drepEnabled() && drepInfo && drepInfo.active && (
        <div>
          ✅ DRep keys have been added and the DRep is registered. Governance is ready!
        </div>
      )}
    </CardUI>
  );
}
