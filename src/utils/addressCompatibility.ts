import { resolvePaymentKeyHash, resolveStakeKeyHash } from "@meshsdk/core";

export type ResolvedKeyHash = {
  keyHash: string;
  type: "payment" | "staking";
};

/**
 * Some legacy Summon wallets use a staking keyhash as the payment credential.
 * Standard payment-key resolution fails on those addresses, so callers that
 * accept arbitrary signer inputs (import flow, validation) should reach for
 * this helper instead of `resolvePaymentKeyHash` directly.
 */
export function resolveKeyHash(address: string): ResolvedKeyHash {
  try {
    return { keyHash: resolvePaymentKeyHash(address), type: "payment" };
  } catch {
    return { keyHash: resolveStakeKeyHash(address), type: "staking" };
  }
}

export function tryResolveKeyHash(address: string): ResolvedKeyHash | null {
  try {
    return resolveKeyHash(address);
  } catch {
    return null;
  }
}
