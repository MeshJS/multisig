import type { CIWalletType } from "../framework/types";
import {
  COLLATERAL_REQUIRED_LOVELACE,
  key,
  parseLovelace,
  type ScriptUtxo,
  type UtxoRef,
  toRef,
} from "./proxyLifecyclePreflight";

export type ProxyCollateralReservation = {
  walletType: CIWalletType;
  reservationKey: string;
  collateralRef: UtxoRef;
};

export function isProxyLifecycleCollateralCandidate(utxo: ScriptUtxo): boolean {
  return (
    parseLovelace(utxo) >= COLLATERAL_REQUIRED_LOVELACE &&
    utxo.output.amount.every((asset) => asset.unit === "lovelace")
  );
}

export function sortCollateralCandidates(utxos: ScriptUtxo[]): ScriptUtxo[] {
  return [...utxos].filter(isProxyLifecycleCollateralCandidate).sort((left, right) => {
    const leftLovelace = parseLovelace(left);
    const rightLovelace = parseLovelace(right);
    if (leftLovelace < rightLovelace) return -1;
    if (leftLovelace > rightLovelace) return 1;
    if (left.input.txHash !== right.input.txHash) {
      return left.input.txHash.localeCompare(right.input.txHash);
    }
    return left.input.outputIndex - right.input.outputIndex;
  });
}

export function createProxyLifecycleReservationKey(walletType: CIWalletType): string {
  return `scenario.proxy-full-lifecycle:${walletType}`;
}

export function reserveProxyLifecycleCollateral(args: {
  walletTypes: CIWalletType[];
  collateralUtxos: ScriptUtxo[];
}): Map<CIWalletType, ProxyCollateralReservation> {
  const candidates = sortCollateralCandidates(args.collateralUtxos);
  if (candidates.length < args.walletTypes.length) {
    throw new Error(
      `Proxy full lifecycle parallel isolation requires ${args.walletTypes.length} distinct ADA-only signer-0 collateral UTxO(s), but only found ${candidates.length}`,
    );
  }

  const reservations = new Map<CIWalletType, ProxyCollateralReservation>();
  const used = new Set<string>();
  for (let i = 0; i < args.walletTypes.length; i += 1) {
    const walletType = args.walletTypes[i]!;
    const candidate = candidates.find((utxo) => !used.has(key(toRef(utxo))));
    if (!candidate) {
      throw new Error(`No unreserved signer-0 collateral UTxO remains for ${walletType}`);
    }
    const collateralRef = toRef(candidate);
    used.add(key(collateralRef));
    reservations.set(walletType, {
      walletType,
      reservationKey: createProxyLifecycleReservationKey(walletType),
      collateralRef,
    });
  }

  return reservations;
}

export function requireReservedCollateralUtxo(args: {
  collateralUtxos: ScriptUtxo[];
  reservedCollateralRef: UtxoRef;
  context: string;
}): ScriptUtxo {
  const reservedKey = key(args.reservedCollateralRef);
  const collateral = args.collateralUtxos.find((utxo) => key(toRef(utxo)) === reservedKey);
  if (!collateral) {
    throw new Error(
      `${args.context} reserved signer-0 collateral UTxO ${reservedKey} is not currently available`,
    );
  }
  if (!isProxyLifecycleCollateralCandidate(collateral)) {
    throw new Error(
      `${args.context} reserved signer-0 collateral UTxO ${reservedKey} is no longer an ADA-only collateral candidate`,
    );
  }
  return collateral;
}
