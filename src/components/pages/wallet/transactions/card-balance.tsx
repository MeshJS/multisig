import Button from "@/components/common/button";
import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { numberWithCommas } from "@/utils/strings";
import { useWalletsStore } from "@/lib/zustand/wallets";
import type { Wallet } from "@/types/wallet";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function CardBalance({ appWallet }: { appWallet: Wallet }) {
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const walletAssets = useWalletsStore((state) => state.walletAssets);
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

  const nonAdaAssets = walletAssets?.filter(
    (asset) => asset.unit !== "lovelace",
  );

  return (
    <CardUI title="Balance" icon={`₳`}>
      <RowLabelInfo
        value={`₳ ${numberWithCommas(balance)}`}
        className="text-2xl font-bold"
      />
      <div>
        {nonAdaAssets?.length > 0 && (
          <p className="mb-2 text-sm text-muted-foreground">
            + {nonAdaAssets.length} asset{nonAdaAssets.length > 1 ? "s" : ""}
          </p>
        )}
        {balance <= 0 && (
          <p className="mb-2 text-sm text-muted-foreground">
            Please deposit fund to this script address before continuing
          </p>
        )}
        <div className="flex space-x-2">
          <Link href={`/wallets/${appWallet.id}/transactions/deposit`}>
            <Button size="sm">Deposit Funds</Button>
          </Link>
          <Link
            href={
              balance > 0 ? `/wallets/${appWallet.id}/transactions/new` : "#"
            }
          >
            <Button size="sm" disabled={balance == 0}>
              New Transaction
            </Button>
          </Link>
        </div>

        {/* Suggesting to disable the button if the balance is less than 0, or no previous transactions */}
        {/* <Button
          onClick={() => {
            window.location.href = `/wallets/${appWallet.id}/transactions/new`;
          }}
          disabled={balance <= 0}
          size="sm"
        >
          New Transaction
        </Button> */}
      </div>
    </CardUI>
  );
}
