import CardUI from "@/components/ui/card-content";
import { Wallet } from "@/types/wallet";

export function MigrateWallet({ appWallet }: { appWallet: Wallet }) {
  return (
    <CardUI
      title="Migrate Wallet"
      description="Adjust the signers and move all funds to a new wallet"
      cardClassName="col-span-2"
    >
      <>Coming soon.</>
    </CardUI>
  );
}
