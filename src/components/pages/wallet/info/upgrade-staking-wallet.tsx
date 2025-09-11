import { useEffect, useMemo, useState } from "react";

import type { MultisigWallet } from "@/utils/multisigSDK";
import { getBalanceFromUtxos, getBalance } from "@/utils/getBalance";

import CardUI from "@/components/ui/card-content";
import { useWalletsStore } from "@/lib/zustand/wallets";
import type { Wallet } from "@/types/wallet";
import RowLabelInfo from "@/components/ui/row-label-info";

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

  useEffect(() => {
    if (!utxos) return;

    const balance = getBalanceFromUtxos(utxos);
    if (!balance) return;
    setBalance(balance);
  }, [utxos]);

  const newAddress = useMemo(() => {
    return mWallet?.getScript().address;
  }, [mWallet]);

  const upgraded = useMemo(() => {
    if (!newAddress) {
      return false;
    }
    return mWallet?.stakingEnabled() && appWallet.address === newAddress;
  }, [mWallet, newAddress, appWallet.address]);

  if (!mWallet || upgraded || appWallet.stakeCredentialHash ) return null;

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
