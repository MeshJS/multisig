import CardUI from "@/components/ui/card-content";
import { MultisigWallet } from "@/utils/multisigSDK";

export function UpgradeStakingWallet({ mWallet }: { mWallet: MultisigWallet }) {
  if (!mWallet || mWallet.stakingEnabled()) return null;

  return (
    <CardUI
      title="Upgrade Wallet"
      description="Add a stake key script to your multisig Wallet."
      cardClassName="col-span-2"
    >
      Not all stake keys have been added. Click Edit Signers to add your stake key!
    </CardUI>
  );
}
