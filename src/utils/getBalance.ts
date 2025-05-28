
import { UTxO } from "@meshsdk/core";

type BalanceMap = Record<string, string>;

export function getBalance(utxos: UTxO[] = []): BalanceMap {
  if (utxos.length === 0) {
    return {};
  }
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
  return balance;
}

export function getBalanceFromUtxos(utxos:UTxO[]) {
    if (utxos) {
      const balance = getBalance(utxos)

      let lovelace = balance.lovelace ? parseInt(balance.lovelace) : 0;
      lovelace = lovelace / 1000000;
      lovelace = Math.round(lovelace * 100) / 100;

      return lovelace;
    }
  }