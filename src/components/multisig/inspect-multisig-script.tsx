import CardUI from "@/components/common/card-content";
import Code from "@/components/common/code";
import RowLabelInfo from "@/components/common/row-label-info";
import { MultisigWallet, stakeAddress } from "@/utils/multisigSDK";
import { Carousel } from "@/components/ui/carousel";

// Carousel state: 0 = 1854, 1 = payment, 2 = stake
export default function InspectMultisigScript({
  wallet,
}: {
  wallet?: MultisigWallet;
}) {
  let slides: React.ReactNode[] = [
    <RowLabelInfo
      label="1854:"
      value={<Code>{JSON.stringify(wallet?.getJsonMetadata(), null, 2)}</Code>}
    />,
    <RowLabelInfo
      label="payment:"
      value={<Code>{JSON.stringify(wallet?.buildScript(0), null, 2)}</Code>}
    />,
  ];

  if (wallet?.buildScript(2) !== undefined) {
    slides.push(
      <RowLabelInfo
        label="stake:"
        value={<Code>{JSON.stringify(wallet.buildScript(2), null, 2)}</Code>}
      />
    );
  }
  if (wallet?.buildScript(3) !== undefined) {
    slides.push(
      <RowLabelInfo
        label="stake:"
        value={<Code>{JSON.stringify(wallet.buildScript(3), null, 2)}</Code>}
      />
    );
  }

  if (!wallet) {
    return null;
  }

  return (
    <CardUI title="Native Script" cardClassName="col-span-2">
      <Carousel slides={slides} />

      <RowLabelInfo
        label="Script CBOR"
        value={<Code>{wallet.getScript().scriptCbor}</Code>}
      />
      <RowLabelInfo
        label="Address"
        value={<Code>{wallet.getScript().address}</Code>}
      />
      {wallet.getStakeAddress() && (
        <RowLabelInfo
          label="Stake Address"
          value={<Code>{wallet.getStakeAddress()}</Code>}
        />
      )}
      <RowLabelInfo label="dRep ID" value={<Code>{wallet.getDRepId()}</Code>} />
    </CardUI>
  );
}
