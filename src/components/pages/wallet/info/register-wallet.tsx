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

  const keys = mWallet?.keys
  //const isRegistered // lookup keys on endpoint 

  return (


    <CardUI
      title="Register Wallet"
      description="Register your Wallet through a CIP-0146 registration transaction."
      cardClassName="col-span-2"
    >

      <>Coming soon.</>
    </CardUI>
  );
}
