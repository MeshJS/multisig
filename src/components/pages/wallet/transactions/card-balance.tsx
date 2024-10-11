import Button from "@/components/common/button";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { numberWithCommas } from "@/lib/strings";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { Wallet } from "@/types/wallet";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function CardBalance({ appWallet }: { appWallet: Wallet }) {
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const utxos = walletsUtxos[appWallet.id];
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    async function getBalance() {
      if (utxos) {
        const _balance = utxos
          .map((utxo) => {
            return utxo.output.amount;
          })
          .reduce(
            (acc, amount) => {
              for (const asset of amount) {
                if (asset) {
                  if (acc[asset.unit] == undefined) {
                    acc[asset.unit] = 0;
                  }
                  if (asset.unit in acc) {
                    acc[asset.unit]! += parseFloat(asset.quantity);
                  }
                }
              }
              return acc;
            },
            {} as { [key: string]: number },
          );

        const balance = Object.fromEntries(
          Object.entries(_balance).map(([key, value]) => [
            key,
            value.toString(),
          ]),
        );

        let lovelace = balance.lovelace ? parseInt(balance.lovelace) : 0;
        lovelace = lovelace / 1000000;
        lovelace = Math.round(lovelace * 100) / 100;

        setBalance(lovelace);
      }
    }
    getBalance();
  }, [utxos]);

  return (
    <CardUI title="Balance" icon={`₳`}>
      <RowLabelInfo
        value={`₳ ${numberWithCommas(balance)}`}
        className="text-2xl font-bold"
      />
      <div>
        <Link href={`/wallets/${appWallet.id}/transactions/new`}>
          <Button size="sm">New Transaction</Button>
        </Link>
      </div>
    </CardUI>
  );
}
