import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { numberWithCommas } from "@/lib/strings";
import { UTxO } from "@meshsdk/core";
import { useEffect, useState } from "react";

export default function CardBalance({ utxos }: { utxos: UTxO[] }) {
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    async function getBalance() {
      // if (wallet) { // todo

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
        Object.entries(_balance).map(([key, value]) => [key, value.toString()]),
      );

      let lovelace = balance["lovelace"] ? parseInt(balance["lovelace"]) : 0;
      lovelace = lovelace / 1000000;
      lovelace = Math.round(lovelace * 100) / 100;

      setBalance(lovelace);
      // }
    }
    getBalance();
  }, [utxos]);

  return (
    <Card className="self-start">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Balance</CardTitle>
        <div className="h-4 w-4 text-muted-foreground">₳</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">₳{numberWithCommas(balance)}</div>
      </CardContent>
    </Card>
  );
}
