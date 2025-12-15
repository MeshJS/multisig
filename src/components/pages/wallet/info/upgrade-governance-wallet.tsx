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
      <div className="space-y-4">
        {!mWallet.drepEnabled() && (!drepInfo || !drepInfo.active) && (
          <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200/50 dark:border-blue-800/50">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              Not all drep keys have been added. Click Edit Signers to add your drep key!
            </p>
          </div>
        )}
        {!mWallet.drepEnabled() && drepInfo && drepInfo.active && (
          <div className="p-4 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border border-yellow-200/50 dark:border-yellow-800/50">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              <span className="font-semibold">⚠️ DRep is currently registered.</span> You must deregister the DRep before adding new DRep keys.
              Go to the Governance section to deregister your DRep first.
            </p>
          </div>
        )}
        {mWallet.drepEnabled() && drepInfo && !drepInfo.active && (
          <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200/50 dark:border-amber-800/50">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              DRep keys have been added to the wallet, but the DRep is not yet registered. 
              Go to the Governance section to register your DRep.
            </p>
          </div>
        )}
        {mWallet.drepEnabled() && drepInfo && drepInfo.active && (
          <div className="p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200/50 dark:border-green-800/50">
            <p className="text-sm text-green-800 dark:text-green-200">
              <span className="font-semibold">✅ Governance Ready!</span> DRep keys have been added and the DRep is registered.
            </p>
          </div>
        )}
      </div>
    </CardUI>
  );
}
