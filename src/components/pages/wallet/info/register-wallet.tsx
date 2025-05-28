import CardUI from "@/components/ui/card-content";
import { Wallet } from "@/types/wallet";
import { MultisigWallet } from "@/utils/multisigSDK";

export function RegisterWallet({
  appWallet,
  mWallet,
}: {
  appWallet: Wallet;
  mWallet?: MultisigWallet;
}) {
  return (
    <CardUI
      title="Register Wallet"
      description="Register your Wallet through an CIP-0146 registration transaction."
      cardClassName="col-span-2"
    >
      <>Coming soon.</>
    </CardUI>
  );
}
