import type { PrismaClient, Proxy } from "@prisma/client";
import type { UTxO } from "@meshsdk/core";
import { getProvider } from "@/utils/get-provider";
import { hasAsset } from "@/lib/server/proxyUtxos";

type AddressUtxoFetcher = {
  fetchAddressUTxOs: (address: string) => Promise<UTxO[]>;
  get?: (path: string) => Promise<unknown>;
};

type TxUtxoEntry = {
  address?: string;
  amount?: { unit?: string; quantity?: string }[];
};

type TxUtxosResponse = {
  inputs?: TxUtxoEntry[];
  outputs?: TxUtxoEntry[];
};

function txEntryHasAsset(entry: TxUtxoEntry, unit: string): boolean {
  return entry.amount?.some((asset) => asset.unit === unit && BigInt(asset.quantity ?? "0") > 0n) ?? false;
}

async function validateCleanupTxHash(args: {
  provider: AddressUtxoFetcher;
  txHash: string;
  proxy: Proxy;
}): Promise<{ error: string; status: number } | null> {
  if (typeof args.provider.get !== "function") {
    return {
      error: "Unable to validate confirmed proxy cleanup txHash: provider does not support transaction lookup",
      status: 400,
    };
  }

  let txUtxos: TxUtxosResponse;
  try {
    txUtxos = (await args.provider.get(`/txs/${args.txHash}/utxos`)) as TxUtxosResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: `Unable to validate confirmed proxy cleanup txHash: ${message}`,
      status: 400,
    };
  }

  const inputs = Array.isArray(txUtxos.inputs) ? txUtxos.inputs : [];
  const outputs = Array.isArray(txUtxos.outputs) ? txUtxos.outputs : [];
  const spentAuthToken = inputs.some((input) => txEntryHasAsset(input, args.proxy.authTokenId));
  const recreatedAuthToken = outputs.some((output) => txEntryHasAsset(output, args.proxy.authTokenId));
  const recreatedProxyOutput = outputs.some((output) => output.address === args.proxy.proxyAddress);
  if (!spentAuthToken || recreatedAuthToken || recreatedProxyOutput) {
    return {
      error: "txHash does not match confirmed proxy cleanup burn outputs",
      status: 400,
    };
  }

  return null;
}

export async function finalizeConfirmedProxyCleanup(args: {
  db: PrismaClient;
  network: number;
  proxy: Proxy;
  walletAddress: string;
  txHash: string;
  deactivateProxy?: boolean;
  provider?: AddressUtxoFetcher;
}): Promise<{ proxy: Proxy } | { error: string; status: number }> {
  const provider = args.provider ?? getProvider(args.network);
  const txHash = args.txHash.trim();
  if (!txHash) {
    return {
      error: "txHash is required",
      status: 400,
    };
  }

  const txHashValidation = await validateCleanupTxHash({
    provider,
    txHash,
    proxy: args.proxy,
  });
  if (txHashValidation) {
    return txHashValidation;
  }

  let walletUtxos: UTxO[];
  let proxyUtxos: UTxO[];
  try {
    [walletUtxos, proxyUtxos] = await Promise.all([
      provider.fetchAddressUTxOs(args.walletAddress),
      provider.fetchAddressUTxOs(args.proxy.proxyAddress),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: `Unable to validate confirmed proxy cleanup from chain: ${message}`,
      status: 400,
    };
  }

  const authTokenStillPresent = [...walletUtxos, ...proxyUtxos].some((utxo) =>
    hasAsset(utxo, args.proxy.authTokenId),
  );
  if (authTokenStillPresent) {
    return {
      error: "Confirmed cleanup not found: auth tokens are still visible on-chain",
      status: 400,
    };
  }

  if (proxyUtxos.length > 0) {
    return {
      error: "Confirmed cleanup not found: proxy address still has on-chain UTxOs",
      status: 400,
    };
  }

  if (args.deactivateProxy === false) {
    return { proxy: args.proxy };
  }

  const proxy = await args.db.proxy.update({
    where: { id: args.proxy.id },
    data: { isActive: false },
  });

  return { proxy };
}
