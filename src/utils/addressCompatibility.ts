import { resolvePaymentKeyHash, resolveStakeKeyHash } from "@meshsdk/core";
import { Address, HexBlob } from "@meshsdk/core-cst";

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

/**
 * CIP-30 wallets (notably mobile in-app browsers) return addresses from
 * getChangeAddress/getUsedAddresses/getRewardAddresses as hex-encoded CBOR
 * bytes rather than bech32. Bech32-only parsers such as `deserializeAddress`
 * throw "Invalid checksum" on that hex, so normalize to bech32 first. The
 * network id is taken from the address header byte, so no network parameter
 * is needed. Returns the input unchanged when it is already bech32 or cannot
 * be parsed as address bytes.
 */
export function normalizeAddressToBech32(address: string): string {
  if (/^(addr|addr_test|stake|stake_test)1/.test(address)) {
    return address;
  }
  if (address.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(address)) {
    try {
      return Address.fromBytes(HexBlob(address)).toBech32();
    } catch {
      // not address bytes; fall through
    }
  }
  return address;
}
