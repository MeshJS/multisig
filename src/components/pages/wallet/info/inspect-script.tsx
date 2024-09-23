import CardUI from "@/components/common/card-content";
import Code from "@/components/common/code";
import RowLabelInfo from "@/components/common/row-label-info";
import { Wallet } from "@/types/wallet";
import { ScrollText } from "lucide-react";

export default function InspectScript({ appWallet }: { appWallet: Wallet }) {
  return (
    <CardUI title="Native Script" icon={ScrollText} cardClassName="col-span-2">
      <RowLabelInfo
        label="Native Script"
        value={<Code>{JSON.stringify(appWallet.nativeScript, null, 2)}</Code>}
      />
      <RowLabelInfo
        label="Script CBOR"
        value={<Code>{appWallet.scriptCbor}</Code>}
      />
    </CardUI>
  );
}
