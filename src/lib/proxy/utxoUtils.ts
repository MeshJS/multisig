import type { UTxO } from "@meshsdk/core";

export type UtxoRef = { txHash: string; outputIndex: number };

export function getLovelace(utxo: UTxO): bigint {
  return BigInt(
    utxo.output.amount.find((asset) => asset.unit === "lovelace")?.quantity ?? "0",
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

/**
 * Greedy UTxO selection covering `outputs` plus an optional `feeBuffer` of lovelace.
 * Throws if the proxy balance is insufficient.
 * Browser callers pass feeBuffer = 500_000n; server callers pass 0n or omit.
 */
export function selectProxyUtxosForOutputs(
  proxyUtxos: UTxO[],
  outputs: { unit: string; amount: string }[],
  feeBuffer?: bigint,
): UTxO[] {
  const requiredByUnit = new Map<string, bigint>();
  for (const output of outputs) {
    const amount = BigInt(output.amount);
    requiredByUnit.set(output.unit, (requiredByUnit.get(output.unit) ?? 0n) + amount);
  }
  requiredByUnit.set(
    "lovelace",
    (requiredByUnit.get("lovelace") ?? 0n) + (feeBuffer ?? 0n),
  );

  const remainingByUnit = new Map(requiredByUnit);
  const candidates = [...proxyUtxos];
  const selected: UTxO[] = [];

  const hasRemaining = () => Array.from(remainingByUnit.values()).some((v) => v > 0n);

  while (hasRemaining()) {
    let bestIndex = -1;
    let bestScore = 0n;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      let score = 0n;
      for (const asset of candidate.output.amount) {
        const remaining = remainingByUnit.get(asset.unit) ?? 0n;
        if (remaining > 0n) {
          const quantity = BigInt(asset.quantity);
          score += quantity < remaining ? quantity : remaining;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex === -1 || bestScore === 0n) {
      throw new Error("Unable to select proxy UTxOs for requested outputs");
    }

    const chosen = candidates.splice(bestIndex, 1)[0]!;
    selected.push(chosen);
    for (const asset of chosen.output.amount) {
      const remaining = remainingByUnit.get(asset.unit) ?? 0n;
      if (remaining > 0n) {
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

export function selectSetupUtxo(utxos: UTxO[]): UTxO | null {
  return utxos.find((utxo) => getLovelace(utxo) >= 20_000_000n) ?? null;
}

export function accumulateFundingUtxos(
  walletUtxos: UTxO[],
  authTokenUtxo: UTxO,
  requiredLovelace: bigint,
): UTxO[] {
  const selected = [authTokenUtxo];
  let total = getLovelace(authTokenUtxo);
  const candidates = walletUtxos
    .filter((u) => !sameUtxoRef(u.input, authTokenUtxo.input))
    .sort((a, b) => Number(getLovelace(b) - getLovelace(a)));
  for (const utxo of candidates) {
    if (total >= requiredLovelace) break;
    selected.push(utxo);
    total += getLovelace(utxo);
  }
  return selected;
}

/**
 * Picks the best free auth-token UTxO from wallet UTxOs.
 * Skips any UTxOs whose refs appear in `blockedUtxoRefs` (server blocked-tx avoidance).
 * Throws if no free auth-token UTxO is available.
 */
export function selectAuthTokenUtxo(
  walletUtxos: UTxO[],
  authTokenPolicyId: string,
  blockedUtxoRefs?: UtxoRef[],
): UTxO {
  const blocked = new Set(
    (blockedUtxoRefs ?? []).map((ref) => `${ref.txHash}#${ref.outputIndex}`),
  );

  const candidates = walletUtxos.filter(
    (utxo) =>
      !blocked.has(`${utxo.input.txHash}#${utxo.input.outputIndex}`) &&
      hasAsset(utxo, authTokenPolicyId),
  );

  if (candidates.length === 0) {
    throw new Error(
      "No AuthToken found at the multisig wallet address. Cancel or complete pending transactions that use the auth token, then try again.",
    );
  }

  return candidates.sort((left, right) => {
    const lovelaceDelta = Number(getLovelace(right) - getLovelace(left));
    if (lovelaceDelta !== 0) return lovelaceDelta;
    if (left.input.txHash !== right.input.txHash) {
      return left.input.txHash.localeCompare(right.input.txHash);
    }
    return left.input.outputIndex - right.input.outputIndex;
  })[0]!;
}
