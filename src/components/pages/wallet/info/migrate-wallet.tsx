import CardUI from "@/components/common/card-content";
import { Wallet } from "@/types/wallet";
import { Pencil } from "lucide-react";

export function MigrateWallet({ appWallet }: { appWallet: Wallet }) {
  return (
    <CardUI
      title="Migrate Wallet"
      description="Adjust the signers and move all funds to a new wallet"
      icon={Pencil}
      cardClassName="col-span-2"
    >
      <>Coming soon.</>
    </CardUI>
  );
}
