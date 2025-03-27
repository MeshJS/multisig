import Button from "@/components/common/button";
import CardUI from "@/components/common/card-content";
import LinkCardanoscan from "@/components/common/link-cardanoscan";
import { useWalletsStore } from "@/lib/zustand/wallets";
import type { Wallet } from "@/types/wallet";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export default function WalletAssets({ appWallet }: { appWallet: Wallet }) {
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const walletAssets = useWalletsStore((state) => state.walletAssets);
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );
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

  const nonAdaList = useMemo(() => {
    const nonAdaAssets = walletAssets?.filter(
      (asset) => asset.unit !== "lovelace",
    );
    return nonAdaAssets?.map((asset) => {
      const metadata = walletAssetMetadata[asset.unit];
      const name = metadata?.assetName ?? asset.unit;
      const quantity =
        Number(asset.quantity) / Math.pow(10, metadata?.decimals ?? 0);
      const ticker = metadata?.ticker;
      const policyId = metadata?.policyId;
      return (
        <div
          key={asset.unit}
          className="flex w-full flex-row items-center justify-between"
        >
          <div>
            <LinkCardanoscan
              url={`tokenPolicy/${policyId}`}
              className="ml-auto gap-1"
            >
              <div className="flex flex-row items-center gap-1">
                <h3 className="text-lg font-bold">{name}</h3>
                <ArrowUpRight className="h-4 w-4" />
              </div>
            </LinkCardanoscan>
          </div>
          <div className="flex flex-row gap-1">
            <p className="font-bold">{quantity}</p>
            <p className="text-gray-400">${ticker}</p>
          </div>
        </div>
      );
    });
  }, [walletAssets, walletAssetMetadata]);

  const adaAmount = useMemo(() => {
    return (
      <div className="flex w-full flex-row items-center justify-between">
        <div className="flex flex-row gap-3">
          <h3 className="text-lg font-bold">ADA</h3>
        </div>
        <div className="flex flex-row gap-1">
          <p className="font-bold">{balance}</p>
          <p className="text-gray-400">₳</p>
        </div>
      </div>
    );
  }, [balance]);

  return (
    <CardUI title="Assets" cardClassName="col">
      <div className="flex flex-col gap-4">
        {adaAmount}
        {nonAdaList}
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
      </div>
    </CardUI>
  );
}
