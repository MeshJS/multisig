import type { UTxO } from "@meshsdk/core";

export type UtxoRef = { txHash: string; outputIndex: number };

export type UtxoFetcher = {
  fetchUTxOs: (hash: string, index?: number) => Promise<UTxO[]>;
};

/**
 * Resolves UTxOs from chain refs only (amounts/addresses from provider).
 * Pass `provider` in tests; defaults to Blockfrost via getProvider(network).
 */
export async function resolveUtxoRefsFromChain(args: {
  network: number;
  utxoRefs: UtxoRef[];
  expectedSpendAddress: string;
  provider?: UtxoFetcher;
}): Promise<{ utxos: UTxO[] } | { error: string; status: number }> {
  const { network, utxoRefs, expectedSpendAddress } = args;
  if (!Array.isArray(utxoRefs) || utxoRefs.length === 0) {
    return { error: "utxoRefs must be a non-empty array", status: 400 };
  }

  const provider =
    args.provider ??
    (await import("@/utils/get-provider")).getProvider(network);
  const utxos: UTxO[] = [];

  for (const ref of utxoRefs) {
    const txHash = typeof ref.txHash === "string" ? ref.txHash.trim() : "";
    const outputIndex =
      typeof ref.outputIndex === "number" && Number.isInteger(ref.outputIndex)
        ? ref.outputIndex
        : -1;
    if (!txHash || outputIndex < 0) {
      return { error: "Invalid utxoRef: txHash and non-negative integer outputIndex required", status: 400 };
    }

    let fetched: UTxO[];
    try {
      fetched = await provider.fetchUTxOs(txHash, outputIndex);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        error: `UTxO not found or not yet available: ${txHash}#${outputIndex} (${msg})`,
        status: 400,
      };
    }

    if (!fetched || fetched.length === 0) {
      return {
        error: `UTxO not found or already spent: ${txHash}#${outputIndex}`,
        status: 400,
      };
    }

    const utxo = fetched[0]!;
    if (utxo.output.address !== expectedSpendAddress) {
      return {
        error: `UTxO ${txHash}#${outputIndex} is not at the multisig spend address for this wallet`,
        status: 400,
      };
    }

    utxos.push(utxo);
  }

  return { utxos };
}
