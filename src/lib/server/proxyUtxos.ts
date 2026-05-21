import type { UTxO } from "@meshsdk/core";
import type { UtxoFetcher, UtxoRef } from "@/lib/server/resolveUtxoRefsFromChain";

export type { UtxoRef };

const MIN_COLLATERAL_LOVELACE = BigInt(5_000_000);

function normalizeUtxoRef(ref: UtxoRef | undefined): UtxoRef | null {
  const txHash = typeof ref?.txHash === "string" ? ref.txHash.trim() : "";
  const outputIndex =
    typeof ref?.outputIndex === "number" && Number.isInteger(ref.outputIndex)
      ? ref.outputIndex
      : -1;

  if (!txHash || outputIndex < 0) {
    return null;
  }

  return { txHash, outputIndex };
}

export function getLovelace(utxo: UTxO): bigint {
  return BigInt(
    utxo.output.amount.find((asset) => asset.unit === "lovelace")?.quantity ??
      "0",
  );
}

export function hasAsset(utxo: UTxO, unit: string, minimum = BigInt(1)): boolean {
  const quantity = BigInt(
    utxo.output.amount.find((asset) => asset.unit === unit)?.quantity ?? "0",
  );
  return quantity >= minimum;
}

export function sameUtxoRef(a: UTxO["input"], b: UTxO["input"]): boolean {
  return a.txHash === b.txHash && a.outputIndex === b.outputIndex;
}

export async function resolveSingleUtxoRefFromChain(args: {
  network: number;
  ref: UtxoRef | undefined;
  expectedAddress?: string;
  provider?: UtxoFetcher;
}): Promise<{ utxo: UTxO } | { error: string; status: number }> {
  const normalized = normalizeUtxoRef(args.ref);
  if (!normalized) {
    return {
      error: "Invalid UTxO ref: txHash and non-negative integer outputIndex required",
      status: 400,
    };
  }

  const provider =
    args.provider ??
    (await import("@/utils/get-provider")).getProvider(args.network);
  let fetched: UTxO[];
  try {
    fetched = await provider.fetchUTxOs(
      normalized.txHash,
      normalized.outputIndex,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: `UTxO not found or not yet available: ${normalized.txHash}#${normalized.outputIndex} (${message})`,
      status: 400,
    };
  }

  const utxo = fetched[0];
  if (!utxo) {
    return {
      error: `UTxO not found or already spent: ${normalized.txHash}#${normalized.outputIndex}`,
      status: 400,
    };
  }

  if (args.expectedAddress && utxo.output.address !== args.expectedAddress) {
    return {
      error: `UTxO ${normalized.txHash}#${normalized.outputIndex} is not at the expected address`,
      status: 400,
    };
  }

  return { utxo };
}

export async function resolveCollateralRefFromChain(args: {
  network: number;
  collateralRef: UtxoRef | undefined;
  expectedAddress?: string;
  provider?: UtxoFetcher;
}): Promise<{ collateral: UTxO } | { error: string; status: number }> {
  const resolved = await resolveSingleUtxoRefFromChain({
    network: args.network,
    ref: args.collateralRef,
    expectedAddress: args.expectedAddress,
    provider: args.provider,
  });
  if ("error" in resolved) {
    return resolved;
  }

  if (getLovelace(resolved.utxo) < MIN_COLLATERAL_LOVELACE) {
    return {
      error: "collateralRef must resolve to a UTxO with at least 5 ADA",
      status: 400,
    };
  }
  if (resolved.utxo.output.amount.some((asset) => asset.unit !== "lovelace")) {
    return {
      error: "collateralRef must resolve to an ADA-only UTxO",
      status: 400,
    };
  }

  return { collateral: resolved.utxo };
}

export function filterBlockedUtxos(
  utxos: UTxO[],
  blockedRefs: UtxoRef[],
): UTxO[] {
  if (blockedRefs.length === 0) {
    return utxos;
  }

  const blocked = new Set(
    blockedRefs.map((ref) => `${ref.txHash}#${ref.outputIndex}`),
  );

  return utxos.filter(
    (utxo) => !blocked.has(`${utxo.input.txHash}#${utxo.input.outputIndex}`),
  );
}

export function extractBlockedUtxoRefsFromPendingTxJson(txJson: string): UtxoRef[] {
  try {
    const parsed = JSON.parse(txJson) as {
      inputs?: Array<{ txIn?: { txHash?: string; txIndex?: number } }>;
    };
    if (!Array.isArray(parsed.inputs)) {
      return [];
    }

    return parsed.inputs
      .map((input) => ({
        txHash: typeof input.txIn?.txHash === "string" ? input.txIn.txHash : "",
        outputIndex:
          typeof input.txIn?.txIndex === "number" && Number.isInteger(input.txIn.txIndex)
            ? input.txIn.txIndex
            : -1,
      }))
      .filter((ref) => ref.txHash.length > 0 && ref.outputIndex >= 0);
  } catch {
    return [];
  }
}

export function selectFreeAuthTokenUtxo(
  utxos: UTxO[],
  authTokenId: string,
  blockedRefs: UtxoRef[] = [],
): UTxO | { error: string } {
  const freeUtxos = filterBlockedUtxos(utxos, blockedRefs);
  const authTokenUtxos = freeUtxos.filter((utxo) => hasAsset(utxo, authTokenId));
  if (authTokenUtxos.length === 0) {
    return {
      error:
        "No free proxy auth-token UTxO found at the multisig wallet address. Cancel or complete pending transactions that use the auth token, then try again.",
    };
  }

  return authTokenUtxos.sort((left, right) => {
    const lovelaceDelta = Number(getLovelace(right) - getLovelace(left));
    if (lovelaceDelta !== 0) {
      return lovelaceDelta;
    }
    if (left.input.txHash !== right.input.txHash) {
      return left.input.txHash.localeCompare(right.input.txHash);
    }
    return left.input.outputIndex - right.input.outputIndex;
  })[0]!;
}

export function requireAuthTokenUtxo(
  utxos: UTxO[],
  authTokenId: string,
): UTxO | { error: string; status: number } {
  const authTokenUtxo = selectFreeAuthTokenUtxo(utxos, authTokenId);
  if ("error" in authTokenUtxo) {
    return {
      error: authTokenUtxo.error,
      status: 400,
    };
  }

  return authTokenUtxo;
}

export function selectProxyUtxosForOutputs(args: {
  proxyUtxos: UTxO[];
  outputs: { unit: string; amount: string; address?: string }[];
  feeBufferLovelace?: bigint;
}): UTxO[] | { error: string; status: number } {
  const requiredByUnit = new Map<string, bigint>();
  for (const output of args.outputs) {
    const amount = BigInt(output.amount);
    requiredByUnit.set(
      output.unit,
      (requiredByUnit.get(output.unit) ?? BigInt(0)) + amount,
    );
  }
  requiredByUnit.set(
    "lovelace",
    (requiredByUnit.get("lovelace") ?? BigInt(0)) +
      (args.feeBufferLovelace ?? BigInt(500_000)),
  );

  const availableByUnit = new Map<string, bigint>();
  for (const utxo of args.proxyUtxos) {
    for (const asset of utxo.output.amount) {
      availableByUnit.set(
        asset.unit,
        (availableByUnit.get(asset.unit) ?? BigInt(0)) + BigInt(asset.quantity),
      );
    }
  }

  for (const [unit, needed] of requiredByUnit.entries()) {
    if ((availableByUnit.get(unit) ?? BigInt(0)) < needed) {
      return {
        error: `Insufficient proxy balance for ${unit}`,
        status: 400,
      };
    }
  }

  const remainingByUnit = new Map(requiredByUnit);
  const candidates = [...args.proxyUtxos];
  const selected: UTxO[] = [];

  const hasRemaining = () =>
    Array.from(remainingByUnit.values()).some((value) => value > BigInt(0));

  while (hasRemaining()) {
    let bestIndex = -1;
    let bestScore = BigInt(0);

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      let score = BigInt(0);
      for (const asset of candidate.output.amount) {
        const remaining = remainingByUnit.get(asset.unit) ?? BigInt(0);
        if (remaining > BigInt(0)) {
          const quantity = BigInt(asset.quantity);
          score += quantity < remaining ? quantity : remaining;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex === -1 || bestScore === BigInt(0)) {
      return { error: "Unable to select proxy UTxOs for requested outputs", status: 400 };
    }

    const chosen = candidates.splice(bestIndex, 1)[0]!;
    selected.push(chosen);
    for (const asset of chosen.output.amount) {
      const remaining = remainingByUnit.get(asset.unit) ?? BigInt(0);
      if (remaining > BigInt(0)) {
        const quantity = BigInt(asset.quantity);
        remainingByUnit.set(
          asset.unit,
          remaining - (quantity < remaining ? quantity : remaining),
        );
      }
    }
  }

  return selected;
}
