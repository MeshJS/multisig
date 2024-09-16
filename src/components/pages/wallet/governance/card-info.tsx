import { Info } from "lucide-react";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";

export default function CardInfo({ appWallet }: { appWallet: Wallet }) {
  return (
    <CardUI title="Info" icon={Info} cardClassName="col-span-2">
      <RowLabelInfo
        label="DRep ID"
        value={appWallet.dRepId}
        copyString={appWallet.dRepId}
      />
      <RowLabelInfo label="Status" value={`Not registered`} />
    </CardUI>
  );
}
