import CardUI from "@/components/ui/card-content";
import UTxOSelector from "@/components/pages/wallet/new-transaction/utxoSelector";
import { StakingInfo } from "../stakingInfoCard";
import { Wallet } from "@/types/wallet";
import StakeButton from "./stake";
import { UTxO } from "@meshsdk/core";
import { useState } from "react";
import { MultisigWallet } from "@/utils/multisigSDK";

export default function StakingActionCard({
  stakingInfo,
  appWallet,
  mWallet,
  network,
  poolHex,
}: {
  stakingInfo: StakingInfo;
  appWallet: Wallet;
  mWallet: MultisigWallet;
  network: number;
  poolHex: string;
}) {
  const [selectedUtxos, setSelectedUtxos] = useState<UTxO[]>([]);
  const [manualSelected, setManualSelected] = useState<boolean>(false);

  return (
    <CardUI title="Staking Actions">
      <div className="flex flex-wrap gap-2">
        {!stakingInfo.active && (
          <StakeButton
            stakingInfo={stakingInfo}
            appWallet={appWallet}
            mWallet={mWallet}
            utxos={selectedUtxos}
            network={network}
            poolHex={poolHex}
            action="registerAndDelegate"
          />
        )}
        {stakingInfo.active && (
          <>
            <StakeButton
              stakingInfo={stakingInfo}
              appWallet={appWallet}
              mWallet={mWallet}
              utxos={selectedUtxos}
              network={network}
              poolHex={poolHex}
              action="delegate"
            />
            <StakeButton
              stakingInfo={stakingInfo}
              appWallet={appWallet}
              mWallet={mWallet}
              utxos={selectedUtxos}
              network={network}
              poolHex={poolHex}
              action="deregister"
            />
          </>
        )}
        {Number(stakingInfo.rewards) > 0 && (
          <StakeButton
            stakingInfo={stakingInfo}
            appWallet={appWallet}
            mWallet={mWallet}
            utxos={selectedUtxos}
            network={network}
            poolHex={poolHex}
            action="withdrawal"
          />
        )}
      </div>
      <div className="mt-4">
        <UTxOSelector
          appWallet={appWallet}
          network={network}
          onSelectionChange={(utxos, manual) => {
            setSelectedUtxos(utxos);
            setManualSelected(manual);
          }}
        />
      </div>
    </CardUI>
  );
}
