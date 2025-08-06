import {useMemo} from "react";

import type { MultisigWallet } from "@/utils/multisigSDK";

import CardUI from "@/components/ui/card-content";

export function UpgradeGovernanceWallet({
  mWallet,
}: {
  mWallet?: MultisigWallet;
}) {



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
      {!mWallet.stakingEnabled() && (
        <div>
          Not all drep keys have been added. Click Edit Signers to add your
          drep key!
        </div>
      )}
    </CardUI>
  );
}
