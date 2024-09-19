import { Info } from "lucide-react";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { useWalletsStore } from "@/lib/zustand/wallets";
import Retire from "./retire";

export default function CardInfo({ appWallet }: { appWallet: Wallet }) {
  const drepRegistered = useWalletsStore((state) => state.drepRegistered);

  return (
    <CardUI title="Info" icon={Info} cardClassName="col-span-2">
      <RowLabelInfo
        label="DRep ID"
        value={appWallet.dRepId}
        copyString={appWallet.dRepId}
      />
      <RowLabelInfo
        label="Status"
        value={drepRegistered ? "Registered" : `Not registered`}
      />
      <Retire appWallet={appWallet} />
    </CardUI>
  );
}
