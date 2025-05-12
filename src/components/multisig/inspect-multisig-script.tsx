import CardUI from "@/components/common/card-content";
import Code from "@/components/common/code";
import RowLabelInfo from "@/components/common/row-label-info";
import type { MultisigWallet } from "@/utils/multisigSDK";
import { Carousel } from "@/components/ui/carousel";

// Carousel state: 0 = 1854, 1 = payment, 2 = stake
export default function InspectMultisigScript({
  mWallet,
}: {
  mWallet?: MultisigWallet;
}) {
  const slides: React.ReactNode[] = [
    <RowLabelInfo
      key="meta"
      label="1854:"
      value={<Code>{JSON.stringify(mWallet?.getJsonMetadata(), null, 2)}</Code>}
    />,
    <RowLabelInfo
      key="payment"
      label="payment:"
      value={<Code>{JSON.stringify(mWallet?.buildScript(0), null, 2)}</Code>}
    />,
  ];

  if (mWallet?.buildScript(2) !== undefined && mWallet.stakingEnabled()) {
    slides.push(
      <RowLabelInfo
        key="stake-2"
        label="stake:"
        value={<Code>{JSON.stringify(mWallet.buildScript(2), null, 2)}</Code>}
      />
    );
  }
  if (mWallet?.buildScript(3) !== undefined) {
    slides.push(
      <RowLabelInfo
        key="stake-3"
        label="stake:"
        value={<Code>{JSON.stringify(mWallet.buildScript(3), null, 2)}</Code>}
      />
    );
  }

  if (!mWallet) {
    return null;
  }

  return (
    <CardUI title="Native Script" cardClassName="col-span-2">
      <Carousel slides={slides} />

      <RowLabelInfo
        label="Script CBOR"
        value={<Code>{mWallet.getScript().scriptCbor}</Code>}
      />
      <RowLabelInfo
        label="Address"
        value={<Code>{mWallet.getScript().address}</Code>}
      />
      {mWallet.stakingEnabled() && mWallet.stakingEnabled() && (
        <RowLabelInfo
          label="Stake Address"
          value={<Code>{mWallet.getStakeAddress()}</Code>}
        />
      )}
      <RowLabelInfo label="dRep ID" value={<Code>{mWallet.getDRepId()}</Code>} />
    </CardUI>
  );
}
