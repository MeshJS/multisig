import type { UTxO } from "@meshsdk/core";
import type {
  CIBootstrapContext,
  CIWalletBalanceEntry,
  CIWalletBalanceSummary,
  CIWalletType,
} from "./types";

type BigIntMap = Map<string, bigint>;

function getBlockfrostApiKey(networkId: 0 | 1): string {
  if (networkId === 0) {
    const preprod = process.env.CI_BLOCKFROST_PREPROD_API_KEY?.trim();
    if (!preprod) {
      throw new Error("CI_BLOCKFROST_PREPROD_API_KEY is required for wallet balance summary");
    }
    return preprod;
  }

  const mainnet = process.env.CI_BLOCKFROST_MAINNET_API_KEY?.trim();
  if (!mainnet) {
    throw new Error("CI_BLOCKFROST_MAINNET_API_KEY is required for wallet balance summary");
  }
  return mainnet;
}

function addAssetQuantity(map: BigIntMap, unit: string, quantityRaw: string): void {
  const quantity = BigInt(quantityRaw);
  map.set(unit, (map.get(unit) ?? 0n) + quantity);
}

function sumUtxoAssets(utxos: UTxO[]): BigIntMap {
  const totals: BigIntMap = new Map();
  for (const utxo of utxos) {
    for (const asset of utxo.output.amount ?? []) {
      if (!asset?.unit || asset.quantity === undefined || asset.quantity === null) {
        continue;
      }
      addAssetQuantity(totals, asset.unit, String(asset.quantity));
    }
  }
  return totals;
}

function toAssetRecord(map: BigIntMap): Record<string, string> {
  return Object.fromEntries(
    Array.from(map.entries()).map(([unit, quantity]) => [unit, quantity.toString()]),
  );
}

function emptySummary(networkId: 0 | 1, error?: string): CIWalletBalanceSummary {
  return {
    capturedAt: new Date().toISOString(),
    networkId,
    byWalletType: {},
    byWalletId: {},
    ...(error ? { error } : {}),
  };
}

export async function collectWalletBalanceSummary(
  ctx: CIBootstrapContext,
): Promise<CIWalletBalanceSummary> {
  try {
    const apiKey = getBlockfrostApiKey(ctx.networkId);
    const { BlockfrostProvider } = await import("@meshsdk/core");
    const provider = new BlockfrostProvider(apiKey);
    const capturedAt = new Date().toISOString();

    const byWalletType: Partial<Record<CIWalletType, CIWalletBalanceEntry>> = {};
    const byWalletId: CIWalletBalanceSummary["byWalletId"] = {};

    for (const wallet of ctx.wallets) {
      const utxos = await provider.fetchAddressUTxOs(wallet.walletAddress);
      const totals = sumUtxoAssets(utxos);
      const assets = toAssetRecord(totals);
      const entry: CIWalletBalanceEntry = {
        walletType: wallet.type,
        walletId: wallet.walletId,
        walletAddress: wallet.walletAddress,
        utxoCount: utxos.length,
        lovelace: (totals.get("lovelace") ?? 0n).toString(),
        assets,
        capturedAt,
        networkId: ctx.networkId,
      };

      byWalletType[wallet.type] = entry;
      byWalletId[wallet.walletId] = entry;
    }

    return {
      capturedAt,
      networkId: ctx.networkId,
      byWalletType,
      byWalletId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptySummary(ctx.networkId, message);
  }
}
