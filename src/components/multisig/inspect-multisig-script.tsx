import CardUI from "@/components/common/card-content";
import Code from "@/components/common/code";
import RowLabelInfo from "@/components/common/row-label-info";
import { type MultisigWallet } from "@/utils/multisigSDK";
import { Carousel } from "@/components/ui/carousel";
import { deserializeAddress } from "@meshsdk/core";
import useAppWallet from "@/hooks/useAppWallet";
import { useEffect, useState } from "react";
import { getBalanceFromUtxos } from "@/utils/getBalance";
import { useWalletsStore } from "@/lib/zustand/wallets";

// Carousel state: 0 = 1854, 1 = payment, 2 = stake
export default function InspectMultisigScript({
  mWallet,
}: {
  mWallet?: MultisigWallet;
}) {
  const { appWallet } = useAppWallet();
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const [balance, setBalance] = useState<number>(0);
  useEffect(() => {
    if (!appWallet) return;
    const utxos = walletsUtxos[appWallet.id];
    if (!utxos) return;
    const balance = getBalanceFromUtxos(utxos);
    if (!balance) return;
    setBalance(balance);
  }, [appWallet, walletsUtxos]);

  if (!mWallet) return null;
  const dSAddr = deserializeAddress(mWallet.getScript().address);

  const slides: React.ReactNode[] = [
    <RowLabelInfo
      key="meta"
      label="1854:"
      value={<Code>{JSON.stringify(mWallet?.getJsonMetadata(), null, 2)}</Code>}
    />,
    <div key="payment">
      <RowLabelInfo
        label="payment:"
        value={<Code>{JSON.stringify(mWallet?.buildScript(0), null, 2)}</Code>}
      />
      <RowLabelInfo label="Keyhash" value={<Code>{dSAddr.scriptHash}</Code>} />
      <RowLabelInfo
        label="CBOR"
        value={<Code>{mWallet.getPaymentScript()}</Code>}
      />
    </div>,
  ];

  if (mWallet?.buildScript(2) !== undefined && mWallet.stakingEnabled()) {
    slides.push(
      <div key="stake-2">
        <RowLabelInfo
          label="stake:"
          value={<Code>{JSON.stringify(mWallet.buildScript(2), null, 2)}</Code>}
        />
        <RowLabelInfo
          label="Keyhash"
          value={<Code>{dSAddr.stakeScriptCredentialHash}</Code>}
        />
        <RowLabelInfo
          label="CBOR"
          value={<Code>{mWallet.getStakingScript()}</Code>}
        />
      </div>,
    );
  }

  if (mWallet?.buildScript(3) !== undefined) {
    slides.push(
      <RowLabelInfo
        key="stake-3"
        label="stake:"
        value={<Code>{JSON.stringify(mWallet.buildScript(3), null, 2)}</Code>}
      />,
    );
  }

  return (
    <CardUI title="Native Script" cardClassName="col-span-2">
      <RowLabelInfo
        label="Address"
        value={<Code>{mWallet.getScript().address}</Code>}
        copyString={mWallet.getScript().address}
      />
      <RowLabelInfo label="Balance" value={<Code>{`${balance} ₳`}</Code>} />
      {mWallet.stakingEnabled() && (
        <RowLabelInfo
          label="Stake Address"
          value={<Code>{mWallet.getStakeAddress()}</Code>}
          copyString={mWallet.getStakeAddress()}
        />
      )}
{/* add pending rewards like balance */}
      <RowLabelInfo
        label="dRep ID"
        value={<Code>{mWallet.getDRepId()}</Code>}
        copyString={mWallet.getDRepId()}
      />

      <Carousel slides={slides} />
    </CardUI>
  );
}
