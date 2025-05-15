import { useEffect, useMemo, useState } from "react";

import { MultisigWallet } from "@/utils/multisigSDK";
import { getBalanceFromUtxos, getBalance } from "@/utils/getBalance";

import CardUI from "@/components/ui/card-content";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { Wallet } from "@/types/wallet";
import RowLabelInfo from "@/components/ui/row-label-info";
import Button from "@/components/common/button";

export function UpgradeStakingWallet({
  appWallet,
  mWallet,
}: {
  appWallet: Wallet;
  mWallet?: MultisigWallet;
}) {
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const utxos = walletsUtxos[appWallet.id];
  const [balance, setBalance] = useState<number>(0);
  const [totalEmpty, setTotalEmpty] = useState<boolean>(false);

  useEffect(() => {
    if (!utxos) return;
    setTotalEmpty(Object.keys(getBalance(utxos)).length === 0);

    const balance = getBalanceFromUtxos(utxos);
    if (!balance) return;
    setBalance(balance);
  }, [utxos]);

  const newAddress = useMemo(() => {
    return mWallet?.getScript().address;
  }, [mWallet]);

  const upgraded = useMemo(() => {
    return mWallet?.stakingEnabled() && appWallet.address === newAddress;
  }, [mWallet, newAddress, appWallet.address]);

  //if balances are 0 update appwallet address to staking address
  const upgradeWallet = ()=>{
    if (mWallet?.stakingEnabled() && newAddress){
    appWallet.address = newAddress;
    }
  }

  if (!mWallet || upgraded ) return null;

  return (
    <CardUI
      title="Upgrade Wallet"
      description="Add a stake key script to your multisig Wallet and tranfer all funds to new Address."
      cardClassName="col-span-2"
    >
      {!mWallet.stakingEnabled() && (
        <div>
          Not all stake keys have been added. Click Edit Signers to add your
          stake key!
        </div>
      )}

      {mWallet.stakingEnabled() && (
        <div>
          Transfer all funds to new Address.
          <RowLabelInfo
            label="Old Address"
            value={appWallet.address}
            copyString={appWallet.address}
          />
          {balance} Ada remaining on old Address.
          <RowLabelInfo
            label="New Stakable Address"
            value={newAddress}
            copyString={newAddress}
          />
        </div>
      )}
    </CardUI>
  );
}
