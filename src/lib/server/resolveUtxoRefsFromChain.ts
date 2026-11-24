import type { UTxO } from "@meshsdk/core";

export type UtxoRef = { txHash: string; outputIndex: number };

export type UtxoFetcher = {
  fetchUTxOs: (hash: string, index?: number) => Promise<UTxO[]>;
};

/**
 * Upper bound on refs per request. A transaction body is at most 16 KiB and
 * every input costs at least 36 bytes (32-byte hash + index + CBOR framing), so
 * no transaction can spend more than this. Some endpoints (the proxy ones)
 * treat `utxoRefs` as a pool they select from, so in principle a client could
 * offer more candidates than get spent — but a pool larger than one
 * transaction could ever use buys nothing. Without a bound, a 200 KB body could name ~2,000 refs and make one
 * request issue ~2,000 Blockfrost calls on the shared project key.
 */
export const MAX_UTXO_REFS = Math.floor((16 * 1024) / 36);

const TX_HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Validates one caller-supplied ref and returns it in canonical form
 * (lowercase hash), or null.
 *
 * The hash is interpolated into the Blockfrost URL (`txs/<hash>/utxos`), so
 * anything other than 64 hex characters is refused here: a value like
 * `../accounts/stake1…` would otherwise send our project key to a different
 * Blockfrost endpoint than the one this code means to call.
 */
export function parseUtxoRef(ref: unknown): UtxoRef | null {
  if (typeof ref !== "object" || ref === null) return null;
  const { txHash: rawHash, outputIndex } = ref as Partial<Record<keyof UtxoRef, unknown>>;
  const txHash = typeof rawHash === "string" ? rawHash.trim().toLowerCase() : "";
  if (!TX_HASH_RE.test(txHash)) return null;
  if (typeof outputIndex !== "number" || !Number.isSafeInteger(outputIndex) || outputIndex < 0) {
    return null;
  }
  return { txHash, outputIndex };
}

/**
 * Resolves UTxOs from chain refs only (amounts/addresses from provider).
 * Pass `provider` in tests; defaults to Blockfrost via getProvider(network).
 *
 * Every ref is validated before the first chain call, so a malformed or
 * repeated ref costs nothing upstream. Refs that share a transaction are
 * resolved with one fetch: Blockfrost returns all outputs of a transaction
 * whether or not an index is given, so fetching per ref only repeated the call.
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
  if (utxoRefs.length > MAX_UTXO_REFS) {
    return {
      error: `utxoRefs may name at most ${MAX_UTXO_REFS} UTxOs (more than one transaction could ever spend)`,
      status: 400,
    };
  }

  const refs: UtxoRef[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of utxoRefs.entries()) {
    const ref = parseUtxoRef(raw);
    if (!ref) {
      return {
        error: `Invalid utxoRefs[${i}]: txHash must be 64 hex characters and outputIndex a non-negative integer`,
        status: 400,
      };
    }
    // A repeated input would be added to the builder twice and its value
    // counted twice when balancing — the request is wrong, not the chain.
    const key = `${ref.txHash}#${ref.outputIndex}`;
    if (seen.has(key)) {
      return { error: `utxoRefs[${i}] repeats ${key}`, status: 400 };
    }
    seen.add(key);
    refs.push(ref);
  }

  const provider =
    args.provider ??
    (await import("@/utils/get-provider")).getProvider(network);
  const outputsByTx = new Map<string, UTxO[]>();
  const utxos: UTxO[] = [];

  for (const { txHash, outputIndex } of refs) {
    let outputs = outputsByTx.get(txHash);
    if (!outputs) {
      try {
        outputs = (await provider.fetchUTxOs(txHash)) ?? [];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          error: `UTxO not found or not yet available: ${txHash}#${outputIndex} (${msg})`,
          status: 400,
        };
      }
      outputsByTx.set(txHash, outputs);
    }

    const utxo = outputs.find((u) => u.input.outputIndex === outputIndex);
    if (!utxo) {
      return {
        error: `UTxO not found or already spent: ${txHash}#${outputIndex}`,
        status: 400,
      };
    }

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
