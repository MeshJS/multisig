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

  if (!mWallet || upgraded) return null;

  // Show info message if external stake credential is set
  if (mWallet.hasExternalStakeCredential()) {
    return (
      <CardUI
        title="Upgrade Wallet"
        description="This wallet uses an external stake credential and cannot be upgraded."
        cardClassName="col-span-2"
      >
        <div className="flex items-start gap-2 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
          <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <p className="font-medium mb-1">External Stake Credential Configured</p>
            <p>
              This wallet uses an external stake credential for staking operations. 
              The upgrade functionality is not available as the wallet already has 
              staking capabilities through the external credential.
            </p>
          </div>
        </div>
      </CardUI>
    );
  }

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
