import Button from "@/components/common/button";
import CardUI from "@/components/ui/card-content";
import LinkCardanoscan from "@/components/common/link-cardanoscan";
import { useWalletsStore } from "@/lib/zustand/wallets";
import type { Wallet } from "@/types/wallet";
import { ArrowUpRight } from "lucide-react";
import { truncateTokenSymbol, numberWithCommas } from "@/utils/strings";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import IPFSImage from "@/components/common/ipfs-image";

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
      const imageSrc = metadata?.image;
      const isImageIpfs = imageSrc?.startsWith("ipfs://");
      return (
        <div
          key={asset.unit}
          className="flex w-full min-w-0 flex-row items-center justify-between gap-3"
        >
          <div className="flex min-w-0 flex-1 flex-row items-center gap-3">
            {imageSrc ? (
              <div
                className={`relative flex h-[60px] w-[60px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full`}
              >
                {isImageIpfs ? (
                  <IPFSImage
                    src={imageSrc}
                    alt={name}
                    width={60}
                    height={60}
                  />
                ) : (
                  <Image
                    src={`data:image/jpeg;base64, ${imageSrc}`}
                    fill={false}
                    alt={name}
                    width={60}
                    height={60}
                    className="object-cover"
                    sizes="60px"
                  />
                )}
              </div>
            ) : (
              <div className="relative flex h-[60px] w-[60px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full">
                <Image
                  src={"/assets/unknown.png"}
                  width={60}
                  height={60}
                  alt={name}
                />
              </div>
            )}
            <LinkCardanoscan
              url={`tokenPolicy/${policyId}`}
              className="min-w-0 gap-1"
            >
              <div className="flex min-w-0 flex-row items-center gap-1">
                <h3 className="truncate text-lg font-bold" title={name}>
                  {truncateTokenSymbol(name)}
                </h3>
                <ArrowUpRight className="h-4 w-4 flex-shrink-0" />
              </div>
            </LinkCardanoscan>
          </div>
          <div className="flex flex-shrink-0 flex-row items-baseline gap-1">
            <p className="font-bold tabular-nums">
              {numberWithCommas(quantity)}
            </p>
            {ticker && (
              <p
                className="max-w-[80px] truncate text-gray-400"
                title={`$${ticker}`}
              >
                ${ticker}
              </p>
            )}
          </div>
        </div>
      );
    });
  }, [walletAssets, walletAssetMetadata]);

  const adaAmount = useMemo(() => {
    return (
      <div className="flex w-full flex-row items-center justify-between">
        <div className="flex flex-row items-center gap-3">
          <div className="relative flex h-[60px] w-[60px] items-center justify-center overflow-hidden rounded-full">
            <Image src={"/assets/ada.png"} width={60} height={60} alt="ADA" />
          </div>
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
